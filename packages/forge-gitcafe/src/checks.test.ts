import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	gitCafeCheckReportInputSchema,
	gitCafeCheckRerequestedEventSchema,
	gitCafeInstallationSchema,
} from "@tripwire/contracts";
import {
	GitCafeInstallationClient,
	reportGitCafeCheck,
	verifyGitCafeCheckRerequest,
} from "@tripwire/forge-gitcafe";
import { generateId } from "@tripwire/utils";
import reportFixture from "../fixtures/gitcafe-check-neutral.json";
import readbackFixture from "../fixtures/gitcafe-check-readback.json";
import rerequestFixture from "../fixtures/gitcafe-check-rerequested-webhook.json";
import installationFixture from "../fixtures/gitcafe-installation.json";
import tokenFixture from "../fixtures/gitcafe-installation-token.json";

const command = gitCafeCheckReportInputSchema.parse({
	repoFullName: "boring/scratch",
	headOid: readbackFixture.headOid,
	key: readbackFixture.key,
	check: {
		name: "tripwire",
		status: "completed",
		conclusion: "neutral",
		reportedAt: readbackFixture.reportedAt,
		output: {
			title: readbackFixture.output.title,
			summary: readbackFixture.output.summary,
		},
		rerequestable: true,
	},
});
const installation = gitCafeInstallationSchema.parse({
	...installationFixture,
	id: readbackFixture.installationId,
	bot: { ...installationFixture.bot, actorId: readbackFixture.reporterId },
});
const credentials = {
	appId: installation.appId,
	keyId: "check-test",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ type: "pkcs8", format: "pem" })
		.toString(),
};

/** Auth transport and negative responses derive from captures; mutations are adversarial peers, not provider fixtures. */
function harness(
	options: {
		report?: unknown;
		readback?: unknown;
		status?: number;
		revokeAfterWrite?: boolean;
	} = {},
) {
	const calls: { method: string; body?: string }[] = [];
	let active = true;
	const client = new GitCafeInstallationClient({
		credentials,
		now: () => Date.parse(readbackFixture.reportedAt),
		lifecycleGuard: async () => active,
		fetch: async (url, init) => {
			if (url.startsWith("https://git.cafe/api/apps/installations/")) {
				return Response.json(
					init.method === "GET"
						? installation
						: {
								...tokenFixture,
								token: "synthetic-check-test-token",
								installationId: installation.id,
								actor: installation.bot.actorId,
								expiresAt: new Date(
									Date.parse(readbackFixture.reportedAt) + 15 * 60_000,
								).toISOString(),
							},
				);
			}
			calls.push({
				method: String(init.method),
				body: String(init.body ?? ""),
			});
			if (init.method === "PUT") {
				if (options.revokeAfterWrite) active = false;
				return Response.json(options.report ?? reportFixture, {
					status: options.status ?? 200,
				});
			}
			return Response.json(options.readback ?? readbackFixture);
		},
	});
	return {
		client,
		calls,
		async run(input = command) {
			const expected = await client.getInstallation(installation.id);
			if (!expected.ok) throw new Error("Test installation lookup failed");
			return reportGitCafeCheck(client, installation.id, expected.value, input);
		},
	};
}

const rerequest = gitCafeCheckRerequestedEventSchema.parse({
	...rerequestFixture,
	checkRun: {
		...rerequestFixture.checkRun,
		key: "tripwire",
		externalId: generateId(),
	},
});
const requestedCheck = {
	...readbackFixture,
	key: "tripwire",
	status: "queued",
	conclusion: null,
	externalId: rerequest.checkRun.externalId,
	rerequestedAt: rerequest.createdAt,
};

test("a re-run request binds the signed check to current installed ownership", async () => {
	const h = harness({ readback: requestedCheck });
	const expected = await h.client.getInstallation(installation.id);
	if (!expected.ok) throw new Error("lookup failed");
	expect(
		await verifyGitCafeCheckRerequest(h.client, expected.value, rerequest),
	).toMatchObject({
		ok: true,
		value: { externalId: rerequest.checkRun.externalId },
	});
	expect(h.calls.map((call) => call.method)).toEqual(["GET"]);
});

for (const change of [
	{ installationId: "another-installation" },
	{ reporterId: "another-bot" },
	{ id: "another-check" },
	{ headOid: "a".repeat(40) },
	{ externalId: generateId() },
	{ key: "another-key" },
	{ name: "another-name" },
	{ rerequestable: false },
	{ rerequestedAt: null },
	{ rerequestedAt: "2026-10-29T00:00:00.000Z" },
	{ reportedAt: "2026-10-29T00:00:00.000Z" },
]) {
	test(`re-run refuses changed current ${Object.keys(change).join()}`, async () => {
		const h = harness({ readback: { ...requestedCheck, ...change } });
		const expected = await h.client.getInstallation(installation.id);
		if (!expected.ok) throw new Error("lookup failed");
		expect(
			(await verifyGitCafeCheckRerequest(h.client, expected.value, rerequest))
				.ok,
		).toBe(false);
	});
}

for (const change of [
	{ installation: { id: "another-installation" } },
	{ bot: { id: "another-bot" } },
	{ actor: { id: installation.bot.actorId } },
	{ actor: undefined },
	{ checkRun: { ...rerequest.checkRun, key: "another-key" } },
	{ checkRun: { ...rerequest.checkRun, externalId: null } },
	{ checkRun: { ...rerequest.checkRun, id: "../another-check" } },
]) {
	test("unbound re-run commands refuse before protected reads", async () => {
		const h = harness({ readback: requestedCheck });
		const expected = await h.client.getInstallation(installation.id);
		if (!expected.ok) throw new Error("lookup failed");
		expect(
			(
				await verifyGitCafeCheckRerequest(
					h.client,
					expected.value,
					gitCafeCheckRerequestedEventSchema.parse({ ...rerequest, ...change }),
				)
			).ok,
		).toBe(false);
		expect(h.calls).toHaveLength(0);
	});
}

describe("captured GitCafe check reporting", () => {
	test("reports a stable command and verifies installed ownership through readback", async () => {
		const h = harness();
		expect(await h.run()).toMatchObject({
			ok: true,
			value: { outcome: "created", checkRun: { id: readbackFixture.id } },
		});
		expect(h.calls.map((call) => call.method)).toEqual(["PUT", "GET"]);
		expect(JSON.parse(h.calls[0]?.body ?? "null")).toEqual(command.check);
	});

	test("retries retain the persisted timestamp and command instead of becoming newer writes", async () => {
		const h = harness({ report: { ...reportFixture, outcome: "unchanged" } });
		expect((await h.run()).ok).toBe(true);
		expect((await h.run()).ok).toBe(true);
		expect(h.calls[0]?.body).toBe(h.calls[2]?.body);
	});

	test("ignored stale reports are refused without treating a newer check as this run's result", async () => {
		const h = harness({
			report: { ...reportFixture, outcome: "ignored_stale" },
		});
		expect(await h.run()).toEqual({ ok: false, reason: "stale" });
		expect(h.calls).toHaveLength(1);
	});

	for (const mutation of [
		{ installationId: "other-installation" },
		{ reporterId: "other-actor" },
		{ headOid: "0".repeat(40) },
		{ key: "other-key" },
		{ conclusion: "success" },
		{ reportedAt: "2026-10-28T11:06:16.000Z" },
		{ output: { ...readbackFixture.output, summary: "unrelated run" } },
	]) {
		test(`refuses a response with different ${Object.keys(mutation)[0]}`, async () => {
			const h = harness({
				report: {
					...reportFixture,
					checkRun: { ...reportFixture.checkRun, ...mutation },
				},
			});
			expect(await h.run()).toEqual({ ok: false, reason: "identity-mismatch" });
			expect(h.calls).toHaveLength(1);
		});
	}

	test("a newer re-run request or state change during readback refuses the old operation", async () => {
		const h = harness({
			readback: {
				...readbackFixture,
				rerequestedAt: "2026-10-28T11:06:17.000Z",
			},
		});
		expect(await h.run()).toEqual({ ok: false, reason: "stale" });
	});

	test("revocation after a successful write prevents its readback from using credentials", async () => {
		const h = harness({ revokeAfterWrite: true });
		expect(await h.run()).toEqual({ ok: false, reason: "inactive" });
		expect(h.calls).toHaveLength(1);
	});

	test("expected HTTP failures remain bounded values", async () => {
		expect(
			await harness({ status: 403, report: { private: "not returned" } }).run(),
		).toEqual({
			ok: false,
			reason: "http",
			status: 403,
		});
	});

	test("invalid status/conclusion pairs fail before a forge write", async () => {
		const h = harness();
		expect(
			await h.run({
				...command,
				check: { ...command.check, status: "queued" },
			}),
		).toEqual({ ok: false, reason: "invalid-response" });
		expect(h.calls).toHaveLength(0);
	});

	test("report and readback must retain requested re-run capability", async () => {
		expect(
			await harness({
				report: {
					...reportFixture,
					checkRun: { ...reportFixture.checkRun, rerequestable: false },
				},
				readback: { ...readbackFixture, rerequestable: false },
			}).run(),
		).toEqual({ ok: false, reason: "identity-mismatch" });
		expect(
			await harness({
				readback: { ...readbackFixture, rerequestable: false },
			}).run(),
		).toEqual({ ok: false, reason: "stale" });
	});

	test("provider-invalid check keys fail before a forge write", async () => {
		for (const key of ["_bad", ".bad", "a".repeat(101)]) {
			const h = harness();
			expect(await h.run({ ...command, key })).toEqual({
				ok: false,
				reason: "invalid-response",
			});
			expect(h.calls).toHaveLength(0);
		}
	});
});
