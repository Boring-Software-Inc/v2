import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	type JsonValue,
	normalizedEventSchema,
	STANDALONE_MODERATION_NODE_ID,
} from "@tripwire/contracts";
import {
	applyMigrations,
	contributionAppealServices,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	RESTORE_CONTRIBUTION_APPEAL_QUEUE,
	runServices,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { createGithubAdapter, GithubHttp } from "@tripwire/forge-github";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import closedIssue from "../../../packages/forge-github/fixtures/appeal-closed-issue.json" with {
	type: "json",
};
import closedEvents from "../../../packages/forge-github/fixtures/appeal-issue-events.json" with {
	type: "json",
};
import { staticForge } from "./forge-runtime.ts";
import { restoreContributionAppeal } from "./jobs/restore-contribution-appeal.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const marker = STANDALONE_MODERATION_NODE_ID;
const logger = pino({ level: "silent" });
const actorId = generateId();
const source = normalizedEventSchema.parse(
	await Bun.file(
		new URL(
			"../../../packages/core/fixtures/change-request.opened.event.json",
			import.meta.url,
		),
	).json(),
);
beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	await db.insert(schema.user).values({
		id: actorId,
		name: "Maintainer",
		email: `${actorId}@example.test`,
	});
}, 120_000);
afterAll(async () => {
	await boss?.stop({ close: true, graceful: false });
	await pool?.end();
	await container?.stop();
});

async function scenario(
	subject: "issue" | "change-request" = "issue",
	kind = "close",
) {
	const repoId = generateId(),
		runId = generateId(),
		eventId = generateId(),
		appealId = generateId();
	const fullName = `appeals/repo-${repoId}`;
	const paused = kind === "human-review";
	const eventBase = {
		...source,
		id: eventId,
		deliveryId: eventId,
		repoExternalId: repoId,
		repo: { owner: "appeals", name: `repo-${repoId}`, fullName },
	};
	const event = normalizedEventSchema.parse(
		subject === "issue"
			? {
					...eventBase,
					kind: "issue.opened",
					actor: {
						login: closedIssue.user.login,
						externalId: String(closedIssue.user.id),
					},
					issue: {
						number: closedIssue.number,
						title: closedIssue.title,
						url: closedIssue.html_url,
						body: closedIssue.body,
						maintainer: false,
					},
				}
			: eventBase,
	);
	if (!("repo" in event)) throw new Error("Expected repo event");
	const number =
		event.kind === "issue.opened"
			? event.issue.number
			: "changeRequest" in event
				? event.changeRequest.number
				: 0;
	await db.insert(schema.repos).values({
		id: repoId,
		externalId: repoId,
		owner: "appeals",
		name: `repo-${repoId}`,
		fullName,
	});
	await db.insert(schema.events).values({
		id: eventId,
		deliveryId: eventId,
		forge: "github",
		rawKind: subject === "issue" ? "issues" : "pull_request",
		raw: {},
		normalized: event,
		kind: event.kind,
		normalizedAt: new Date(),
	});
	await db.insert(schema.runs).values({
		id: runId,
		eventId,
		repoFullName: fullName,
		subjectNumber: number,
		subjectKind: subject,
		headSha: "changeRequest" in event ? event.changeRequest.headSha : null,
		workflowSnapshot: paused
			? [
					{
						...DEFAULT_WORKFLOW,
						nodes: [
							...DEFAULT_WORKFLOW.nodes,
							{
								id: "moderation-outcome",
								type: "action",
								action: "send-to-moderation",
								params: {},
							},
						],
					},
				]
			: [DEFAULT_WORKFLOW],
		status: paused ? "paused" : "completed",
		verdict: paused ? "needs_review" : kind === "close" ? "close" : "block",
	});
	const closeEvent = closedEvents[0];
	if (!closeEvent) throw new Error("Expected a captured close event");
	const at = new Date(closeEvent.created_at);
	await db.insert(schema.runSteps).values({
		id: generateId(),
		runId,
		nodeId: marker,
		nodeKind: "action",
		status: paused ? "paused" : "pass",
		output: { outcome: kind },
		startedAt: at,
		finishedAt: at,
		durationMs: 0,
	});
	const originalId = generateId();
	if (!paused)
		await db.insert(schema.runActions).values({
			id: originalId,
			runId,
			kind,
			payload: { nodeId: marker },
			status: "executed",
			idempotencyKey: "outcome",
			recordedAt: at,
			executedAt: at,
			externalId: kind === "block" ? "42" : null,
		});
	const itemId = paused ? generateId() : null;
	if (itemId)
		await db
			.insert(schema.moderationItems)
			.values({ id: itemId, runId, nodeId: marker });
	await db.insert(schema.contributionAppeals).values({
		id: appealId,
		runId,
		repoId,
		subjectKind: subject,
		subjectNumber: number,
		accountId: event.actor.externalId,
		login: event.actor.login,
		reason: "Review this",
		status: "approve-once",
		decidedBy: actorId,
	});
	const calls: string[] = [];
	let state = subject === "issue" && !paused ? closedIssue.state : "open";
	let locked = kind === "lock";
	let failRestore = false;
	const options = {
		tokenFor: async () => "test",
		appId: 3169732,
		apiBase: "https://fake.api",
		fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
			const path = String(url).replace("https://fake.api", "");
			const method = init?.method ?? "GET";
			calls.push(`${method} ${path}`);
			let body: JsonValue = {};
			if (method === "GET" && path.includes("/reviews"))
				body = [
					{
						id: 42,
						state: "CHANGES_REQUESTED",
						performed_via_github_app: { id: 3169732 },
					},
				];
			else if (method === "GET" && path.includes("/events"))
				body = closedEvents.map((e) => ({
					...e,
					event: kind === "lock" ? "locked" : e.event,
				}));
			else if (method === "GET" && path.startsWith("/apps/"))
				body = { id: 3169732 };
			else if (method === "GET" && path.includes("/pulls/"))
				body = {
					merged: false,
					head: {
						sha: "changeRequest" in event ? event.changeRequest.headSha : "",
					},
				};
			else if (method === "GET" && path.includes("check-runs"))
				body = { total_count: 0, check_runs: [] };
			else if (method === "GET" && path.includes("/comments")) body = [];
			else if (method === "GET") {
				body = {
					...closedIssue,
					state,
					locked,
					user: { id: Number(event.actor.externalId) },
				};
				if (subject === "change-request") body.pull_request = {};
			} else if (method === "PATCH" && !path.includes("/comments")) {
				if (failRestore)
					return new Response("temporarily down", { status: 503 });
				state = "open";
			} else if (method === "DELETE" && path.endsWith("/lock")) locked = false;
			else body = { id: 42 };
			return new Response(JSON.stringify(body), { status: 200 });
		}) as typeof fetch,
	};
	const deps = {
		db,
		pool,
		logger,
		appUrl: "https://tripwire.test",
		makeGenerate: null,
		resolveForge: staticForge({
			adapter: createGithubAdapter(options),
			signalHttp: new GithubHttp(options),
		}),
	};
	return {
		repoId,
		runId,
		eventId,
		appealId,
		number,
		fullName,
		event,
		originalId,
		itemId,
		calls,
		deps,
		fail: () => {
			failRestore = true;
		},
		recover: () => {
			failRestore = false;
		},
	};
}

test("approved closed issue reopens once and records its original effect and restoration", async () => {
	const s = await scenario();
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	expect(s.calls.filter((c) => c.startsWith("PATCH "))).toHaveLength(1);
	const data = await runServices.getRunWithSteps(db, s.runId);
	expect(data?.run.verdict).toBe("pass");
	expect(data?.actions.find((a) => a.id === s.originalId)?.status).toBe(
		"suppressed",
	);
	expect(data?.actions.find((a) => a.kind === "reopen")?.status).toBe(
		"executed",
	);
	expect(data?.steps.filter((a) => a.nodeId.endsWith(s.appealId))).toHaveLength(
		1,
	);
});

test("approved locked issue unlocks without closing or reopening", async () => {
	const s = await scenario("issue", "lock");
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	expect(
		s.calls.filter((c) => c.startsWith("DELETE ") && c.endsWith("/lock")),
	).toHaveLength(1);
	expect(s.calls.some((c) => c.startsWith("PATCH "))).toBe(false);
});

test("a later run prevents restoration", async () => {
	const s = await scenario();
	const newerEventId = generateId();
	await db.insert(schema.events).values({
		id: newerEventId,
		deliveryId: newerEventId,
		forge: "github",
		rawKind: "issues",
		raw: {},
		kind: "issue.opened",
		normalized: s.event,
	});
	await db.insert(schema.runs).values({
		id: generateId(),
		eventId: newerEventId,
		repoFullName: s.fullName,
		subjectNumber: s.number,
		subjectKind: "issue",
		workflowSnapshot: [DEFAULT_WORKFLOW],
		status: "completed",
		verdict: "block",
	});
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	expect(s.calls).toHaveLength(0);
	expect(
		(await runServices.getRunWithSteps(db, s.runId))?.actions,
	).toHaveLength(1);
});

test("an explicit workflow close remains effective after the standalone appeal", async () => {
	const s = await scenario();
	await db.insert(schema.runActions).values({
		id: generateId(),
		runId: s.runId,
		kind: "close",
		payload: { nodeId: "custom-workflow:close" },
		status: "executed",
		idempotencyKey: "explicit-close",
		executedAt: new Date(),
	});
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	expect(s.calls.some((c) => c.startsWith("PATCH "))).toBe(false);
	expect(
		(await runServices.getRunWithSteps(db, s.runId))?.actions.some(
			(a) => a.kind === "reopen",
		),
	).toBe(false);
});

test("a failed forge restoration retries its persisted intent", async () => {
	const s = await scenario();
	s.fail();
	await expect(
		restoreContributionAppeal(s.deps, { appealId: s.appealId }),
	).rejects.toThrow();
	expect(
		(await runServices.getRunWithSteps(db, s.runId))?.actions.find(
			(a) => a.kind === "reopen",
		)?.status,
	).toBe("recorded");
	s.recover();
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	expect(
		(await runServices.getRunWithSteps(db, s.runId))?.actions.filter(
			(a) => a.kind === "reopen",
		),
	).toHaveLength(1);
	expect(
		(await runServices.getRunWithSteps(db, s.runId))?.actions.find(
			(a) => a.kind === "reopen",
		)?.status,
	).toBe("executed");
});

test("approving a PR clears its check and owned review through the existing surfaces", async () => {
	const s = await scenario("change-request", "block");
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	const data = await runServices.getRunWithSteps(db, s.runId);
	expect(data?.run.verdict).toBe("pass");
	expect(
		data?.actions.some(
			(a) => a.kind === "set-check" && a.status === "executed",
		),
	).toBe(true);
	expect(
		data?.actions.some(
			(a) => a.kind === "dismiss-review" && a.status === "executed",
		),
	).toBe(true);
});

test("appeal decision and queue admission commit together and reject duplicate decisions", async () => {
	const s = await scenario();
	await db
		.update(schema.contributionAppeals)
		.set({ status: "pending" })
		.where(eq(schema.contributionAppeals.id, s.appealId));
	const decide = () =>
		contributionAppealServices.decideAppeal(
			db,
			{
				repoId: s.repoId,
				appealId: s.appealId,
				decidedBy: actorId,
				decision: "approve-once",
			},
			async () => {},
			{ pool, boss },
		);
	expect(await decide()).toBe(true);
	expect(await decide()).toBe(false);
	const jobs = await boss.fetch<{ appealId: string }>(
		RESTORE_CONTRIBUTION_APPEAL_QUEUE,
	);
	expect(jobs.filter((j) => j.data.appealId === s.appealId)).toHaveLength(1);
});

test("queue admission failure rolls back the approval and callback writes", async () => {
	const s = await scenario();
	await db
		.update(schema.contributionAppeals)
		.set({ status: "pending" })
		.where(eq(schema.contributionAppeals.id, s.appealId));
	await expect(
		contributionAppealServices.decideAppeal(
			db,
			{
				repoId: s.repoId,
				appealId: s.appealId,
				decidedBy: actorId,
				decision: "approve-once",
			},
			async (tx) => {
				await tx
					.update(schema.repos)
					.set({ armed: true })
					.where(eq(schema.repos.id, s.repoId));
			},
			{
				pool,
				boss: {
					insert: async () => {
						throw new Error("admission failed");
					},
				} as unknown as PgBoss,
			},
		),
	).rejects.toThrow("admission failed");
	const [appeal] = await db
		.select()
		.from(schema.contributionAppeals)
		.where(eq(schema.contributionAppeals.id, s.appealId));
	const [repo] = await db
		.select()
		.from(schema.repos)
		.where(eq(schema.repos.id, s.repoId));
	expect(appeal?.status).toBe("pending");
	expect(repo?.armed).toBe(false);
});

test("approving a paused standalone outcome resumes its moderation item", async () => {
	const s = await scenario("issue", "human-review");
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	const data = await runServices.getRunWithSteps(db, s.runId);
	const [item] = await db
		.select()
		.from(schema.moderationItems)
		.where(eq(schema.moderationItems.runId, s.runId));
	expect(item?.status).toBe("approved");
	expect(item?.appliedAt).toBeInstanceOf(Date);
	expect(data?.run.verdict).toBe("pass");
	expect(data?.run.status).toBe("completed");
	expect(
		data?.steps.find(
			(step) => step.nodeId === `${marker}:resume` && step.status === "skipped",
		),
	).toBeDefined();
});

test("appeal approval keeps an explicit workflow review pending", async () => {
	const s = await scenario("issue", "human-review");
	const otherItemId = generateId();
	await db
		.insert(schema.moderationItems)
		.values({ id: otherItemId, runId: s.runId, nodeId: "explicit:review" });
	await restoreContributionAppeal(s.deps, { appealId: s.appealId });
	const data = await runServices.getRunWithSteps(db, s.runId);
	const [item] = await db
		.select()
		.from(schema.moderationItems)
		.where(eq(schema.moderationItems.id, otherItemId));
	expect(item?.status).toBe("pending");
	expect(data?.run.status).toBe("paused");
	expect(data?.run.verdict).toBe("needs_review");
});
