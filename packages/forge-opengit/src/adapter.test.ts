import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { CHECK_NAME } from "@tripwire/contracts";
import type { ForgeAction } from "@tripwire/forge";
import { createOpenGitAdapter } from "./adapter.ts";
import { createBotJwt, OpenGitTokenCache } from "./client/auth.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

const CREDS = { botId: "bot-1", privateKey };

interface Call {
	url: string;
	method: string;
	body: unknown;
	authorization: string;
}

/** Records every request and replies with `reply`, so tests assert the wire. */
function recordingFetch(reply: unknown = { id: "check-uuid" }) {
	const calls: Call[] = [];
	const fetchImpl = ((url: string, init?: RequestInit) => {
		calls.push({
			url: String(url),
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			authorization: String(
				(init?.headers as Record<string, string>)?.authorization ?? "",
			),
		});
		return Promise.resolve(
			new Response(JSON.stringify(reply), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

function adapterWith(fetchImpl: typeof fetch) {
	return createOpenGitAdapter({
		tokenFor: () => Promise.resolve("ogi_token"),
		fetchImpl,
	});
}

const CHECK = {
	sha: "abc123",
	summary: "tripwire — 1 rule failed",
	detailsUrl: "https://tripwire.sh/runs/1",
};

describe("open-git bot jwt", () => {
	test("issues RS256 with the bot id and an under-10m life", () => {
		const now = 1_760_000_000_000;
		const jwt = createBotJwt(CREDS, now);
		const [header, payload] = jwt.split(".");
		const decode = (part: string) =>
			JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
		expect(decode(String(header)).alg).toBe("RS256");
		const claims = decode(String(payload));
		// open-git verifies `issuer: bot.id` and rejects anything older than 10m.
		expect(claims.iss).toBe("bot-1");
		expect(claims.exp - claims.iat).toBeLessThan(600);
		expect(publicKey).toContain("BEGIN PUBLIC KEY");
	});
});

describe("open-git installation tokens", () => {
	test("mints once and serves the cached token until it nears expiry", async () => {
		const { calls, fetchImpl } = recordingFetch({
			token: "ogi_abc",
			expires_at: new Date(Date.now() + 3_600_000).toISOString(),
		});
		const cache = new OpenGitTokenCache(CREDS, undefined, fetchImpl);
		expect(await cache.getToken("inst-1")).toBe("ogi_abc");
		expect(await cache.getToken("inst-1")).toBe("ogi_abc");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain(
			"/api/v1/app/installations/inst-1/access_tokens",
		);
	});
});

describe("open-git check — the whole merge gate", () => {
	test("upserts one tripwire check on the head sha", async () => {
		const { calls, fetchImpl } = recordingFetch();
		const result = await adapterWith(fetchImpl).execute({
			kind: "set-check",
			repoFullName: "acme/api",
			check: { ...CHECK, conclusion: "failure" },
		});
		expect(calls).toHaveLength(1);
		const call = calls[0];
		// POST upserts by name — no read-then-write, so it cannot double-post.
		expect(call?.method).toBe("POST");
		expect(call?.url).toContain("/api/v1/repos/acme/api/commits/abc123/checks");
		expect(call?.authorization).toBe("Bearer ogi_token");
		expect(call?.body).toMatchObject({ name: CHECK_NAME, status: "failed" });
		expect(result.externalId).toBe("check-uuid");
	});

	test.each([
		["success", "success"],
		["failure", "failed"],
		["pending", "running"],
		// open-git's gate is binary and has no advisory state, so needs_review
		// HOLDS the merge rather than passing — the fail-closed direction, and a
		// deliberate divergence from GitHub's non-blocking neutral.
		["neutral", "failed"],
	] as const)("%s maps to open-git status %s", async (conclusion, status) => {
		const { calls, fetchImpl } = recordingFetch();
		await adapterWith(fetchImpl).execute({
			kind: "set-check",
			repoFullName: "acme/api",
			check: { ...CHECK, conclusion },
		});
		expect(calls[0]?.body).toMatchObject({ status });
	});

	test("a long summary is trimmed, not rejected", async () => {
		const { calls, fetchImpl } = recordingFetch();
		await adapterWith(fetchImpl).execute({
			kind: "set-check",
			repoFullName: "acme/api",
			check: { ...CHECK, conclusion: "failure", summary: "x".repeat(5000) },
		});
		// open-git caps summary at 2000 and 422s the whole write past it.
		expect(
			String((calls[0]?.body as { summary: string }).summary),
		).toHaveLength(2000);
	});
});

describe("actions open-git cannot perform", () => {
	/**
	 * These throw rather than reporting success. `block` and `dismiss-review`
	 * are best-effort at the caller and settle with a warning; the rest stay
	 * recorded. Returning `{externalId: null}` would put an action in the audit
	 * trail that never happened.
	 */
	const UNSUPPORTED: readonly (readonly [string, ForgeAction])[] = [
		[
			"block",
			{ kind: "block", repoFullName: "acme/api", number: 1, reason: "no" },
		],
		[
			"label",
			{ kind: "label", repoFullName: "acme/api", number: 1, labels: ["x"] },
		],
		[
			"request-review",
			{ kind: "request-review", repoFullName: "acme/api", number: 1 },
		],
		[
			"dismiss-review",
			{
				kind: "dismiss-review",
				repoFullName: "acme/api",
				number: 1,
				reviewId: "r1",
			},
		],
	];

	test.each(
		UNSUPPORTED,
	)("%s throws and reaches no endpoint", async (_name, action) => {
		const { calls, fetchImpl } = recordingFetch();
		await expect(adapterWith(fetchImpl).execute(action)).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});
});

describe("the absent read surface", () => {
	/**
	 * An empty diff is a CLAIM — it would make max-files-changed pass and
	 * honeypot find nothing. Throwing degrades instead, and the worker's read
	 * guard records it so the affected rules skip (§6).
	 */
	test.each([
		"getDiff",
		"getCommits",
		"readFile",
		"getContributorProfile",
	])("%s throws rather than returning empty", async (method) => {
		const { fetchImpl } = recordingFetch();
		const adapter = adapterWith(fetchImpl);
		const call = adapter[method as "getDiff"] as () => Promise<unknown>;
		expect(() => call()).toThrow(/exposes no/);
	});

	test("the adapter still declares its forge", () => {
		const { fetchImpl } = recordingFetch();
		expect(adapterWith(fetchImpl).forge).toBe("opengit");
	});
});

describe("comments — append on a transition, never on a repeat", () => {
	const comment = (verdict: string, previousVerdict: string | null) => ({
		kind: "comment" as const,
		repoFullName: "acme/api",
		number: 7,
		body: "**tripwire** blocked this change",
		verdict,
		previousVerdict,
	});

	test("a first verdict posts, and returns the comment id", async () => {
		const { calls, fetchImpl } = recordingFetch({ id: "c-1" });
		const result = await adapterWith(fetchImpl).execute(
			comment("block", null) as never,
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toContain("/api/v1/repos/acme/api/pulls/7/comments");
		expect(calls[0]?.body).toMatchObject({
			body: "**tripwire** blocked this change",
		});
		expect(result.externalId).toBe("c-1");
	});

	test("a flip posts a new comment", async () => {
		const { calls, fetchImpl } = recordingFetch({ id: "c-2" });
		await adapterWith(fetchImpl).execute(comment("pass", "block") as never);
		expect(calls).toHaveLength(1);
	});

	/**
	 * The whole reason this is bounded. open-git cannot edit or delete a comment,
	 * so re-posting an unchanged verdict on every push would bury the change
	 * request in identical comments.
	 */
	test("an unchanged verdict says nothing at all", async () => {
		const { calls, fetchImpl } = recordingFetch({ id: "c-3" });
		const result = await adapterWith(fetchImpl).execute(
			comment("block", "block") as never,
		);
		expect(calls).toHaveLength(0);
		expect(result.externalId).toBeNull();
	});
});
