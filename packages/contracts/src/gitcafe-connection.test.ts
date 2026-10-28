import { expect, test } from "bun:test";
import {
	forgeConnectable,
	forgeEvaluates,
	forgeSchema,
	gitCafeConnectionConfirmationResultSchema,
	gitCafeConnectionConfirmationSchema,
	gitCafeConnectionJobSchema,
	gitCafeConnectionRefusalSchema,
	gitCafeConnectionSelectionSchema,
	gitCafeConnectionStatusInputSchema,
	gitCafeSetupContextSchema,
	ingestForgeSchema,
	providerAvailabilitySchema,
	setupSearchSchema,
} from "./index.ts";

test("generated adversarial RPC outputs are rejected without admitting private fields", () => {
	const context = {
		orgs: [{ id: "org", slug: "team", name: "Team" }],
		suggestedOrg: "team",
	};
	expect(gitCafeSetupContextSchema.parse(context)).toEqual(context);
	expect(
		gitCafeSetupContextSchema.parse({ orgs: [], suggestedOrg: null }),
	).toEqual({ orgs: [], suggestedOrg: null });
	for (const input of [
		{ ...context, accessToken: "private" },
		{ ...context, suggestedOrg: "../other" },
		{ ...context, orgs: [{ id: "", slug: "team", name: "Team" }] },
		{ ...context, orgs: [{ ...context.orgs[0], slug: "admin" }] },
		{ ...context, orgs: [{ ...context.orgs[0], proofHandle: "a".repeat(48) }] },
	])
		expect(gitCafeSetupContextSchema.safeParse(input).success).toBe(false);
	const success = {
		ok: true,
		jobId: "01900000-0000-7000-8000-000000000001",
	} as const;
	expect(gitCafeConnectionConfirmationResultSchema.parse(success)).toEqual(
		success,
	);
	for (const reason of [
		...gitCafeConnectionRefusalSchema.options,
		"unavailable",
		"refused",
		"retry",
	] as const) {
		expect(
			gitCafeConnectionConfirmationResultSchema.parse({ ok: false, reason }),
		).toEqual({ ok: false, reason });
	}
	for (const input of [
		{ ok: true },
		{ ...success, jobId: "invalid" },
		{ ...success, accessToken: "private" },
		{ ok: false, reason: "unknown" },
		{ ok: false, reason: "retry", proofHandle: "a".repeat(48) },
	])
		expect(
			gitCafeConnectionConfirmationResultSchema.safeParse(input).success,
		).toBe(false);
});

test("GitCafe admits connected storage without ingestion, reviews, or evaluation", () => {
	expect(forgeSchema.parse("gitcafe")).toBe("gitcafe");
	expect(ingestForgeSchema.safeParse("gitcafe").success).toBe(false);
	expect(forgeConnectable("gitcafe")).toBe(true);
	expect(forgeEvaluates("gitcafe")).toBe(false);
	expect(ingestForgeSchema.options).toEqual(["github", "opengit"]);
});

test("provider availability has one exact public list", () => {
	expect(
		providerAvailabilitySchema.parse({ available: ["github", "gitcafe"] }),
	).toEqual({ available: ["github", "gitcafe"] });
	for (const input of [
		{ signIn: ["github"], connect: ["gitcafe"] },
		{ available: [], secret: "private" },
	])
		expect(providerAvailabilitySchema.safeParse(input).success).toBe(false);
});

test("bounded connection job rejects secrets, unsafe timestamps, and excess TTL", () => {
	const job = {
		userId: "local-user",
		sessionId: "local-session",
		orgId: "local-org",
		installationId: "ins_staging",
		subject: "delegating-subject",
		actorId: "act_delegate",
		authorizedAt: Date.now(),
		expiresAt: Date.now() + 300_000,
		requestId: "request",
	};
	expect(gitCafeConnectionJobSchema.parse(job)).toEqual(job);
	for (const overrides of [
		{ accessToken: "secret" },
		{ privateKey: "secret" },
		{ expiresAt: job.authorizedAt + 300_001 },
		{ expiresAt: job.authorizedAt },
		{ authorizedAt: Number.MAX_SAFE_INTEGER + 1 },
	])
		expect(
			gitCafeConnectionJobSchema.safeParse({ ...job, ...overrides }).success,
		).toBe(false);
});

test("web selection, confirmation and refresh status keep distinct strict boundaries", () => {
	const selection = { org: "boring", installationId: "ins_staging" };
	expect(gitCafeConnectionSelectionSchema.parse(selection)).toEqual(selection);
	expect(
		gitCafeConnectionSelectionSchema.safeParse({
			...selection,
			actorId: "act_attacker",
		}).success,
	).toBe(false);
	expect(
		gitCafeConnectionConfirmationSchema.parse({
			...selection,
			proofHandle: "a".repeat(48),
		}).proofHandle,
	).toHaveLength(48);
	expect(
		gitCafeConnectionStatusInputSchema.safeParse({ ...selection, jobId: "bad" })
			.success,
	).toBe(false);
	expect(
		setupSearchSchema.parse({
			installation_id: 42,
			forge: "gitcafe",
			org: "boring",
			proofHandle: "a".repeat(48),
		}),
	).toMatchObject({ installation_id: "42", forge: "gitcafe", org: "boring" });
});
