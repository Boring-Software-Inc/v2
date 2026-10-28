import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
	gitCafePullEventSchema,
	gitCafeReadProfileSchema,
} from "@tripwire/contracts";
import { evaluateRule, getRule } from "@tripwire/core";
import {
	GitCafeInstallationClient,
	GitCafeReads,
	hydrateGitCafePullEvent,
	normalizeGitCafePullEvent,
} from "@tripwire/forge-gitcafe";
import pino from "pino";
import { buildRuleContext } from "./context.ts";

const logger = pino({ level: "silent" });
const fixture = (name: string) =>
	Bun.file(
		new URL(
			`../../../packages/forge-gitcafe/fixtures/${name}.json`,
			import.meta.url,
		),
	);
const capturedInstallation = gitCafeInstallationSchema.parse(
	await fixture("gitcafe-installation").json(),
);
const capturedToken = gitCafeInstallationTokenSchema.parse(
	await fixture("gitcafe-installation-token").json(),
);
const created = gitCafePullEventSchema.parse(
	await fixture("gitcafe-pull-created-webhook").json(),
);
const headOid = created.pull.headOid;
if (headOid === null) throw new Error("Captured PR has no head");
const profile = gitCafeReadProfileSchema.parse(
	await fixture("gitcafe-read-profile").json(),
);
const privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
	.privateKey.export({ format: "pem", type: "pkcs8" })
	.toString();

type FailedRead =
	| "diff-file"
	| "commits"
	| "members"
	| "collaborators"
	| "history";

function recordingLogger() {
	const lines: string[] = [];
	return {
		lines,
		logger: pino(
			{ level: "warn" },
			{
				write: (line) => {
					lines.push(line);
				},
			},
		),
	};
}

/** Only the transport faults and current-installation binding are synthetic; successful API bodies come from captures. */
function harness(
	options: {
		failure?: FailedRead;
		failures?: readonly FailedRead[];
		wrongActor?: boolean;
	} = {},
) {
	const installation = { ...capturedInstallation, id: created.installation.id };
	const client = new GitCafeInstallationClient({
		credentials: { appId: installation.appId, keyId: "test-only", privateKey },
		now: () => Date.parse(capturedToken.expiresAt) - 900_000,
		lifecycleGuard: async () => true,
		fetch: async (rawUrl) => {
			const url = new URL(rawUrl);
			if (url.pathname.endsWith("/access_tokens"))
				return Response.json({
					...capturedToken,
					installationId: installation.id,
					token: "synthetic-test-bearer",
				});
			if (url.pathname.includes("/apps/installations/"))
				return Response.json(installation);
			const failures =
				options.failures ?? (options.failure ? [options.failure] : []);
			if (
				failures.some((failure) =>
					failure === "history"
						? url.pathname.endsWith("/pulls/")
						: url.pathname.includes(failure),
				)
			)
				return new Response(null, { status: 503 });
			if (url.pathname === "/api/users/grim")
				return Response.json({
					...profile,
					actorId: options.wrongActor ? "different-actor" : profile.actorId,
				});
			const name = url.pathname.endsWith("/repos/boring/scratch")
				? "gitcafe-connection-repository"
				: url.pathname.endsWith("/pulls/1")
					? "gitcafe-read-scratch-pull"
					: url.pathname.endsWith("/changes")
						? "gitcafe-read-scratch-changes"
						: url.pathname.endsWith("/diff-file")
							? "gitcafe-read-scratch-diff-0"
							: url.pathname.endsWith("/commits")
								? "gitcafe-read-scratch-commits"
								: url.pathname.endsWith("/members/")
									? "gitcafe-connection-members"
									: url.pathname.endsWith("/collaborators/")
										? "gitcafe-read-collaborators"
										: url.pathname.endsWith("/pulls/")
											? "gitcafe-read-pulls"
											: null;
			if (name === null) throw new Error("Unexpected transport request");
			return new Response(await fixture(name).text(), {
				headers: { "content-type": "application/json" },
			});
		},
	});
	const reads = new GitCafeReads({ client, installationId: installation.id });
	return { client, reads };
}

async function eventFor(client: GitCafeInstallationClient) {
	const lookup = await client.getInstallation(created.installation.id);
	if (!lookup.ok) throw new Error("lookup failed");
	const hydrated = await hydrateGitCafePullEvent(client, lookup.value, created);
	if (!hydrated.ok) throw new Error(`hydration refused: ${hydrated.reason}`);
	const event = normalizeGitCafePullEvent(hydrated.value, created.createdAt);
	if (!event || !("repo" in event)) throw new Error("missing repository event");
	return event;
}

test("the actual GitCafe reader feeds verified diff, commits and contributor facts into RuleContext", async () => {
	const h = harness();
	const event = await eventFor(h.client);
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		h.reads,
		created.createdAt,
		logger,
	);
	expect(degradedReads).toEqual([]);
	expect(ctx.diff?.[0]).toMatchObject({
		path: "tripwire-qa.txt",
		status: "added",
		additions: 2,
		deletions: 0,
		patchUnavailable: null,
	});
	expect(ctx.diff?.[0]?.patch).toContain(
		"+Tripwire staging adapter acceptance fixture.",
	);
	expect(ctx.commits?.[0]?.sha).toBe(headOid);
	expect(ctx.contributor).toMatchObject({
		login: profile.handle,
		profileText: profile.bio,
		createdAt: null,
		mergedElsewhere: null,
		recentChangeRequestTimes: null,
	});
	const maxFiles = getRule("max-files-changed@1");
	if (!maxFiles) throw new Error("missing rule");
	/** Data evaluation is exercised separately from the catalog gate, which must still refuse GitCafe activation. */
	expect(await evaluateRule(maxFiles, ctx, { max: 1 })).toMatchObject({
		status: "skipped",
	});
	expect(await maxFiles.evaluate(ctx, { max: 1 })).toMatchObject({
		status: "evaluated",
		passed: true,
		evidence: { filesChanged: 1, max: 1 },
	});
	const accountAge = getRule("account-age@1");
	if (!accountAge) throw new Error("missing rule");
	expect((await accountAge.evaluate(ctx, { minDays: 30 })).status).toBe(
		"skipped",
	);
});

test("unavailable patch metadata retains the complete file list and records partial evidence", async () => {
	const h = harness({ failure: "diff-file" });
	const event = await eventFor(h.client);
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		h.reads,
		created.createdAt,
		logger,
	);
	expect(degradedReads).toEqual(["diff"]);
	expect(ctx.diff).toHaveLength(1);
	expect(ctx.diff?.[0]).toMatchObject({
		path: "tripwire-qa.txt",
		additions: null,
		deletions: null,
		patchUnavailable: "unavailable",
	});
	expect(ctx.diff?.[0]?.patch).toBeUndefined();
	const maxFiles = getRule("max-files-changed@1");
	if (!maxFiles) throw new Error("missing rule");
	expect(await maxFiles.evaluate(ctx, { max: 1 })).toMatchObject({
		status: "evaluated",
		passed: true,
		evidence: { filesChanged: 1, max: 1 },
	});
	expect(ctx.contributor?.profileText).toBe(profile.bio);
});

test("one refused read degrades only its evidence and returns no exception", async () => {
	const h = harness({ failure: "commits" });
	const event = await eventFor(h.client);
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		h.reads,
		created.createdAt,
		logger,
	);
	expect(degradedReads).toEqual(["commits"]);
	expect(ctx.commits).toBeNull();
	expect(ctx.diff).toHaveLength(1);
	expect(ctx.contributor?.profileText).toBe(profile.bio);
});

test("membership unavailability cannot grant an exemption or discard profile text", async () => {
	const h = harness({ failure: "members" });
	const event = await eventFor(h.client);
	const { ctx } = await buildRuleContext(
		event,
		h.reads,
		created.createdAt,
		logger,
	);
	expect(ctx.contributor?.isOrgMember).toBeNull();
	expect(ctx.contributor?.isMaintainer).toBeNull();
	expect(ctx.contributor?.profileText).toBe(profile.bio);
	expect(ctx.contributor?.mergedInRepo).toBe(0);
});

test("a reused handle cannot substitute another contributor's facts", async () => {
	const h = harness({ wrongActor: true });
	const event = await eventFor(h.client);
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		h.reads,
		created.createdAt,
		logger,
	);
	expect(degradedReads).toEqual(["contributor"]);
	expect(ctx.contributor).toBeNull();
	expect(ctx.diff).toHaveLength(1);
});

for (const [failure, source] of [
	["members", "organization-membership"],
	["history", "merged-history"],
	["collaborators", "repository-collaborators"],
] as const) {
	test(`partial ${failure} failures remain auditable without discarding healthy facts`, async () => {
		const h = harness({ failure });
		const event = await eventFor(h.client);
		const log = recordingLogger();
		const { ctx, degradedReads } = await buildRuleContext(
			event,
			h.reads,
			created.createdAt,
			log.logger,
		);
		expect(degradedReads).toEqual(["contributor"]);
		expect(log.lines).toHaveLength(1);
		expect(log.lines[0]).toContain(`"source":"${source}"`);
		expect(log.lines[0]).toContain('"reason":"http"');
		expect(log.lines[0]).toContain('"status":503');
		expect(log.lines[0]).not.toContain("synthetic-test-bearer");
		expect(ctx.contributor?.profileText).toBe(profile.bio);
		expect(ctx.diff).toHaveLength(1);
		if (failure === "history") expect(ctx.contributor?.mergedInRepo).toBeNull();
		if (failure === "members") expect(ctx.contributor?.isOrgMember).toBeNull();
	});
}

test("three partial failures record the degraded contributor once and retain each bounded diagnostic", async () => {
	const h = harness({ failures: ["history", "members", "collaborators"] });
	const event = await eventFor(h.client);
	const log = recordingLogger();
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		h.reads,
		created.createdAt,
		log.logger,
	);
	expect(degradedReads).toEqual(["contributor"]);
	expect(log.lines).toHaveLength(3);
	expect(ctx.contributor?.profileText).toBe(profile.bio);
	expect(ctx.contributor?.mergedInRepo).toBeNull();
	expect(ctx.contributor?.isOrgMember).toBeNull();
	expect(ctx.contributor?.isMaintainer).toBeNull();
});
