import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	type GitCafeInstallation,
	type GitCafeInstallationToken,
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
} from "@tripwire/contracts";
import {
	GitCafeInstallationClient,
	type GitCafeInstallationClientOptions,
} from "@tripwire/forge-gitcafe";
import installationFixture from "../fixtures/gitcafe-installation.json";
import tokenFixture from "../fixtures/gitcafe-installation-token.json";

const installation = gitCafeInstallationSchema.parse(installationFixture);
const token = gitCafeInstallationTokenSchema.parse(tokenFixture);
const NOW = Date.parse(token.expiresAt) - 15 * 60_000;
const credentials = {
	appId: installation.appId,
	keyId: "unit-test-key",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};

function harness() {
	let clock = NOW;
	let lookup = installation;
	let overrides: Partial<GitCafeInstallationToken> = {};
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch = async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return init.method === "GET"
			? Response.json(lookup)
			: Response.json({
					...token,
					token: "opaque-unit-test-token",
					expiresAt: new Date(clock + 15 * 60_000).toISOString(),
					...overrides,
				});
	};
	return {
		calls,
		fetch,
		now: () => clock,
		advance: (ms: number) => {
			clock += ms;
		},
		lookup: (next: GitCafeInstallation) => {
			lookup = next;
		},
		token: (next: Partial<GitCafeInstallationToken>) => {
			overrides = next;
		},
	};
}

function clientFor(h: ReturnType<typeof harness>, fetch = h.fetch) {
	return new GitCafeInstallationClient({ credentials, now: h.now, fetch });
}

function deferred<T>() {
	let complete: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		complete = resolve;
	});
	return {
		promise,
		resolve(value: T) {
			if (!complete) throw new Error("Deferred promise was not initialized");
			complete(value);
		},
	};
}

describe("GitCafe installation client", () => {
	test("captured installation names and redacted token responses parse", () => {
		expect(installation.repositories).toEqual(["scratch"]);
		expect(installation.bot.handle).toBe("boring-tripwire-staging");
		expect(token.token).toBe("[REDACTED]");
	});

	test("authenticates lookup and mint through their separate fixed-origin transports", async () => {
		const h = harness();
		const result = await clientFor(h).getToken(installation.id);
		expect(result).toEqual({ ok: true, value: "opaque-unit-test-token" });
		expect(h.calls.map((c) => c.url)).toEqual([
			`https://git.cafe/api/apps/installations/${installation.id}`,
			`https://git.cafe/api/apps/installations/${installation.id}/access_tokens`,
		]);
		const lookup = h.calls[0];
		const mint = h.calls[1];
		if (!lookup || !mint) throw new Error("Expected both transports");
		expect(new Headers(lookup.init.headers).get("authorization")).toStartWith(
			"Bearer ",
		);
		expect(new Headers(mint.init.headers).has("authorization")).toBe(false);
		expect(h.calls.every((c) => c.init.redirect === "manual")).toBe(true);
	});

	test("reuses a token only after a fresh installation lookup", async () => {
		const h = harness();
		const client = clientFor(h);
		await client.getToken(installation.id);
		await client.getToken(installation.id);
		expect(h.calls.map((c) => c.init.method)).toEqual(["GET", "POST", "GET"]);
	});

	test("coalesces concurrent lookup and mint calls", async () => {
		const h = harness();
		const client = clientFor(h);
		const results = await Promise.all(
			Array.from({ length: 20 }, () => client.getToken(installation.id)),
		);
		expect(results.every((result) => result.ok)).toBe(true);
		expect(h.calls.map((c) => c.init.method)).toEqual(["GET", "POST"]);
	});

	test("refreshes before expiry", async () => {
		const h = harness();
		const client = clientFor(h);
		await client.getToken(installation.id);
		h.advance(15 * 60_000 - 30_000);
		expect((await client.getToken(installation.id)).ok).toBe(true);
		expect(h.calls.filter((c) => c.init.method === "POST")).toHaveLength(2);
	});

	for (const field of ["pausedAt", "suspendedAt", "uninstalledAt"] as const) {
		test(`refuses a previously cached token after ${field}`, async () => {
			const h = harness();
			const client = clientFor(h);
			await client.getToken(installation.id);
			h.lookup({ ...installation, [field]: new Date(NOW).toISOString() });
			expect(await client.getToken(installation.id)).toEqual({
				ok: false,
				reason: "inactive",
			});
			h.lookup(installation);
			expect((await client.getToken(installation.id)).ok).toBe(true);
			expect(h.calls.filter((c) => c.init.method === "POST")).toHaveLength(2);
		});
	}

	for (const changed of [
		{ id: "another-installation" },
		{ appId: "another-app" },
	]) {
		test(`refuses lookup identity mismatch ${Object.keys(changed)[0]}`, async () => {
			const h = harness();
			h.lookup({ ...installation, ...changed });
			expect(await clientFor(h).getToken(installation.id)).toEqual({
				ok: false,
				reason: "identity-mismatch",
			});
			expect(h.calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
		});
	}

	const mismatches: Partial<GitCafeInstallationToken>[] = [
		{ installationId: "another-installation" },
		{ actor: "another-bot" },
		{ repositories: ["unselected-private-repo"] },
		{ repositorySelection: "all" },
		{ permissions: [{ kind: "repo", family: "contents", level: "admin" }] },
	];
	for (const changed of mismatches) {
		test(`refuses token authority mismatch ${Object.keys(changed)[0]}`, async () => {
			const h = harness();
			h.token(changed);
			expect(await clientFor(h).getToken(installation.id)).toEqual({
				ok: false,
				reason: "identity-mismatch",
			});
		});
	}

	test("does not reuse a token after an installation revision changes", async () => {
		const h = harness();
		const client = clientFor(h);
		await client.getToken(installation.id);
		h.lookup({ ...installation, version: installation.version + 1 });
		expect((await client.getToken(installation.id)).ok).toBe(true);
		expect(h.calls.filter((c) => c.init.method === "POST")).toHaveLength(2);
	});

	for (const expiresAt of [
		new Date(NOW).toISOString(),
		new Date(NOW + 24 * 60 * 60_000).toISOString(),
		"not-a-date",
	]) {
		test(`rejects unusable token expiry ${expiresAt}`, async () => {
			const h = harness();
			h.token({ expiresAt });
			expect(await clientFor(h).getToken(installation.id)).toEqual({
				ok: false,
				reason: "invalid-response",
			});
		});
	}

	test("refuses an accidentally deployed redacted fixture token", async () => {
		const h = harness();
		h.token({ token: "[REDACTED]" });
		expect(await clientFor(h).getToken(installation.id)).toEqual({
			ok: false,
			reason: "invalid-response",
		});
	});

	test("a failed mint is retried by the next caller without retaining failure", async () => {
		const h = harness();
		let fail = true;
		const fetch: NonNullable<GitCafeInstallationClientOptions["fetch"]> = (
			url,
			init,
		) => {
			if (init.method === "POST" && fail) {
				fail = false;
				throw new Error("transport failure");
			}
			return h.fetch(url, init);
		};
		const client = clientFor(h, fetch);
		expect(await client.getToken(installation.id)).toEqual({
			ok: false,
			reason: "network",
		});
		expect((await client.getToken(installation.id)).ok).toBe(true);
	});

	test("HTTP failure values exclude provider response bodies", async () => {
		const h = harness();
		const client = clientFor(
			h,
			async () => new Response("sensitive-provider-response", { status: 401 }),
		);
		expect(await client.getToken(installation.id)).toEqual({
			ok: false,
			reason: "http",
			status: 401,
		});
	});

	for (const body of ["invalid JSON", " ".repeat(1024 * 1024 + 1), "{}"]) {
		test(`refuses malformed or oversized lookup (${body.length} bytes)`, async () => {
			const h = harness();
			const client = clientFor(h, async () => new Response(body));
			expect(await client.getToken(installation.id)).toEqual({
				ok: false,
				reason: "invalid-response",
			});
		});
	}

	test("rejects path injection before any request", async () => {
		const h = harness();
		expect(await clientFor(h).getToken("../other-installation")).toEqual({
			ok: false,
			reason: "invalid-installation-id",
		});
		expect(h.calls).toHaveLength(0);
	});

	test("invalidation while lookup is pending refuses the stale result", async () => {
		const h = harness();
		const response = deferred<Response>();
		const client = clientFor(h, () => response.promise);
		const lookup = client.getToken(installation.id);
		client.invalidate(installation.id);
		response.resolve(Response.json(installation));
		expect(await lookup).toEqual({ ok: false, reason: "stale" });
	});

	test("invalidation while mint is pending cannot resurrect its token", async () => {
		const h = harness();
		const response = deferred<Response>();
		const started = deferred<void>();
		let first = true;
		const client = clientFor(h, (url, init) => {
			if (init.method === "POST" && first) {
				first = false;
				started.resolve();
				return response.promise;
			}
			return h.fetch(url, init);
		});
		const mint = client.getToken(installation.id);
		await started.promise;
		client.invalidate(installation.id);
		response.resolve(
			Response.json({ ...token, token: "old-token-from-before-revocation" }),
		);
		expect(await mint).toEqual({ ok: false, reason: "stale" });
		expect(await client.getToken(installation.id)).toEqual({
			ok: true,
			value: "opaque-unit-test-token",
		});
	});

	test("a newer installation version fences an older in-flight mint", async () => {
		const h = harness();
		const response = deferred<Response>();
		const started = deferred<void>();
		let first = true;
		const client = clientFor(h, (url, init) => {
			if (init.method === "POST" && first) {
				first = false;
				started.resolve();
				return response.promise;
			}
			return h.fetch(url, init);
		});
		const older = client.getToken(installation.id);
		await started.promise;
		h.lookup({ ...installation, version: installation.version + 1 });
		expect((await client.getToken(installation.id)).ok).toBe(true);
		response.resolve(Response.json({ ...token, token: "old-version-token" }));
		expect(await older).toEqual({ ok: false, reason: "stale" });
		expect(await client.getToken(installation.id)).toEqual({
			ok: true,
			value: "opaque-unit-test-token",
		});
		expect(h.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
	});

	test("lost lookup authority fences an in-flight mint", async () => {
		const h = harness();
		const response = deferred<Response>();
		const started = deferred<void>();
		let failLookup = false;
		const client = clientFor(h, (url, init) => {
			if (init.method === "GET" && failLookup) {
				return Promise.resolve(new Response(null, { status: 403 }));
			}
			if (init.method === "POST") {
				started.resolve();
				return response.promise;
			}
			return h.fetch(url, init);
		});
		const older = client.getToken(installation.id);
		await started.promise;
		failLookup = true;
		expect(await client.getToken(installation.id)).toEqual({
			ok: false,
			reason: "http",
			status: 403,
		});
		response.resolve(Response.json({ ...token, token: "revoked-token" }));
		expect(await older).toEqual({ ok: false, reason: "stale" });
	});
});
