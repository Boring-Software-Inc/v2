import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	DEFAULT_RESPONSE_CONFIG,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	moderationServices,
	repoServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";
import { resumeRun } from "./jobs/resume-run.ts";

/**
 * §6 — the moderation queue IS a paused run: needs_review halts the run and
 * creates an item; approve/deny resumes down the corresponding edge; the
 * audit trail and PR surface behave like any automatic outcome.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });

const MODERATED: WorkflowDefinition = {
	id: "moderated@1",
	name: "moderated gate",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{
			id: "age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 30 },
		},
		{ id: "mod", type: "action", action: "send-to-moderation" },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "age", to: "mod", when: "fail" },
		{ id: "e3", from: "mod", to: "block", when: "deny" },
	],
};

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

const freshReads = {
	getDiff: () => Promise.resolve([]),
	getCommits: () => Promise.resolve([]),
	getContributorProfile: () =>
		Promise.resolve({
			login: "sockpuppet",
			externalId: "999",
			createdAt: new Date(Date.now() - 86_400_000).toISOString(),
			followers: 0,
			following: 0,
			publicRepos: 0,
			profileText: null,
			mergedInRepo: 0,
			mergedElsewhere: 0,
			recentChangeRequestTimes: [],
			isOrgMember: false,
			isMaintainer: false,
		}),
};

const deps = () => ({
	db,
	pool,
	logger,
	resolveForge: staticForge({ reads: freshReads }),
	makeGenerate: null,
	appUrl: "https://tripwire.sh",
});

describe("moderation queue = paused run", () => {
	test("needs_review pauses the run and creates a pending item", async () => {
		const raw = await Bun.file(
			new URL(
				"../../../packages/forge-github/fixtures/pull_request.opened.json",
				import.meta.url,
			).pathname,
		).json();
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "186853002",
			owner: "Codertocat",
			name: "Hello-World",
			fullName: "Codertocat/Hello-World",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await repoServices.saveWorkflowDefinition(db, repoId, MODERATED);

		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "mod-1",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent(deps(), { eventId });

		const run = await pool.query(
			"SELECT id, status, verdict FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(run.rows[0].status).toBe("paused");
		expect(run.rows[0].verdict).toBe("needs_review");

		const items = await moderationServices.listPendingItems(
			db,
			"Codertocat/Hello-World",
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.runId).toBe(run.rows[0].id);
		expect(items[0]?.nodeId).toBe("moderated@1:mod");
		expect(items[0]?.actorLogin).toBe("Codertocat");
	});

	test("deny resumes down the deny edge ⇒ block; item decided; surface re-emitted", async () => {
		const items = await moderationServices.listPendingItems(
			db,
			"Codertocat/Hello-World",
		);
		const item = items[0];
		if (!item) {
			throw new Error("no pending item");
		}
		const decided = await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "deny",
			decidedBy: null,
		});
		expect(decided).toBe(true);

		await resumeRun(deps(), { itemId: item.id, decision: "deny" });

		const run = await pool.query(
			"SELECT status, verdict FROM runs WHERE id = $1",
			[item.runId],
		);
		expect(run.rows[0].status).toBe("completed");
		expect(run.rows[0].verdict).toBe("block");

		const steps = await pool.query(
			"SELECT node_id, status FROM run_steps WHERE run_id = $1 AND node_id LIKE '%:resume'",
			[item.runId],
		);
		expect(steps.rowCount).toBeGreaterThanOrEqual(1);

		const actions = await pool.query(
			"SELECT kind FROM run_actions WHERE run_id = $1 ORDER BY kind",
			[item.runId],
		);
		const kinds = actions.rows.map((r) => r.kind);
		expect(kinds).toContain("block");
		expect(kinds.filter((k) => k === "comment").length).toBe(2);

		expect(
			await moderationServices.listPendingItems(db, "Codertocat/Hello-World"),
		).toHaveLength(0);

		const second = await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "approve",
			decidedBy: null,
		});
		expect(second).toBe(false);
	});
});

/**
 * T4 live finding — deny must never fail open. The graph below is the T4
 * editor emission verbatim: fail edge straight into send-to-moderation, NO
 * deny edge. Deny floors to block; approve stays resume-to-pass.
 */
const T4_GRAPH: WorkflowDefinition = {
	id: "default@1",
	name: "default gate",
	version: 1,
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
		{
			id: "send-to-moderation-1",
			type: "action",
			action: "send-to-moderation",
		},
		{
			id: "account-age-1",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 9999 },
		},
	],
	edges: [
		{ id: "edge-2", from: "trigger", to: "account-age-1" },
		{
			id: "edge-4",
			from: "account-age-1",
			to: "send-to-moderation-1",
			when: "fail",
		},
	],
};

async function pauseT4Run(
	deliveryId: string,
	resolveForge = deps().resolveForge,
) {
	const raw = await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		).pathname,
	).json();
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind: "pull_request",
		raw,
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	await processEvent({ ...deps(), resolveForge }, { eventId });
	const items = await moderationServices.listPendingItems(
		db,
		"Codertocat/Hello-World",
	);
	const item = items[0];
	if (!item) {
		throw new Error("no pending item");
	}
	return item;
}

describe("deny floor — deny with no deny edge never fails open", () => {
	beforeAll(async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "186853002",
			owner: "Codertocat",
			name: "Hello-World",
			fullName: "Codertocat/Hello-World",
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await pool.query(
			"UPDATE workflow_definitions SET enabled = false WHERE repo_id = $1",
			[repoId],
		);
		await repoServices.saveWorkflowDefinition(db, repoId, T4_GRAPH);
	});

	test("deny ⇒ verdict floors to block; synthetic step + executed block action; failure check + blocked comment rows", async () => {
		const item = await pauseT4Run("deny-floor-1");
		expect(item.nodeId).toBe("default@1:send-to-moderation-1");

		await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "deny",
			decidedBy: null,
		});
		await resumeRun(deps(), { itemId: item.id, decision: "deny" });

		const run = await pool.query(
			"SELECT status, verdict FROM runs WHERE id = $1",
			[item.runId],
		);
		expect(run.rows[0].status).toBe("completed");
		expect(run.rows[0].verdict).toBe("block");

		const floor = await pool.query(
			"SELECT status, output FROM run_steps WHERE run_id = $1 AND node_id = 'run:deny-floor'",
			[item.runId],
		);
		expect(floor.rowCount).toBe(1);
		expect(floor.rows[0].output.rule).toBe(
			"deny → block (graph produced no block action)",
		);

		const actions = await pool.query(
			"SELECT kind, payload, idempotency_key FROM run_actions WHERE run_id = $1",
			[item.runId],
		);
		const kinds = actions.rows.map((r) => r.kind);
		expect(kinds).toContain("block");
		const check = actions.rows.find(
			(r) => r.kind === "set-check" && r.idempotency_key.endsWith(":block"),
		);
		expect(check?.payload.conclusion).toBe("failure");
		const comment = actions.rows.find(
			(r) => r.kind === "comment" && r.idempotency_key.endsWith(":block"),
		);
		expect(comment).toBeDefined();
	});

	test("approve on the same graph ⇒ pass (no floor)", async () => {
		const item = await pauseT4Run("deny-floor-2");
		await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "approve",
			decidedBy: null,
		});
		await resumeRun(deps(), { itemId: item.id, decision: "approve" });

		const run = await pool.query(
			"SELECT status, verdict FROM runs WHERE id = $1",
			[item.runId],
		);
		expect(run.rows[0].status).toBe("completed");
		expect(run.rows[0].verdict).toBe("pass");

		const floor = await pool.query(
			"SELECT 1 FROM run_steps WHERE run_id = $1 AND node_id = 'run:deny-floor'",
			[item.runId],
		);
		expect(floor.rowCount).toBe(0);
	});

	test("degraded-floor resume (run:degraded) unchanged: deny ⇒ block via resumeDegradedRun", async () => {
		// Fail-closed floor needs skipped ≥ 50% of active rule nodes. A single
		// broken contributor read only skips account-age; leftover derived rules
		// (crypto/honeypot/…) still pass under the composition model. Break every
		// injectable read so the floor trips regardless of which graph runs.
		const raw = await Bun.file(
			new URL(
				"../../../packages/forge-github/fixtures/pull_request.opened.json",
				import.meta.url,
			).pathname,
		).json();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "deny-floor-degraded",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		const brokenReads = {
			getDiff: () => Promise.reject(new Error("creds down")),
			getCommits: () => Promise.reject(new Error("creds down")),
			getContributorProfile: () => Promise.reject(new Error("creds down")),
		};
		await processEvent(
			{ ...deps(), resolveForge: staticForge({ reads: brokenReads }) },
			{ eventId },
		);

		const items = await moderationServices.listPendingItems(
			db,
			"Codertocat/Hello-World",
		);
		const item = items.find((i) => i.nodeId === "run:degraded");
		if (!item) {
			throw new Error("no degraded item");
		}
		await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "deny",
			decidedBy: null,
		});
		await resumeRun(deps(), { itemId: item.id, decision: "deny" });

		const run = await pool.query(
			"SELECT status, verdict FROM runs WHERE id = $1",
			[item.runId],
		);
		expect(run.rows[0].status).toBe("completed");
		expect(run.rows[0].verdict).toBe("block");
	});
});

describe("a resumed run moves the change request off human review", () => {
	function surfaceRecorder() {
		const comments: {
			verdict: string;
			previousVerdict: string | null;
			body: string;
		}[] = [];
		const checks: string[] = [];
		const adapter = {
			execute: (action: {
				kind: string;
				body?: string;
				verdict?: string;
				previousVerdict?: string | null;
				check?: { conclusion: string };
			}) => {
				if (action.kind === "comment") {
					comments.push({
						verdict: action.verdict ?? "",
						previousVerdict: action.previousVerdict ?? null,
						body: action.body ?? "",
					});
				}
				if (action.kind === "set-check" && action.check) {
					checks.push(action.check.conclusion);
				}
				return Promise.resolve({ externalId: null });
			},
		};
		return {
			comments,
			checks,
			resolveForge: staticForge({
				adapter: adapter as never,
				reads: freshReads,
			}),
		};
	}

	async function pauseOn(
		number: number,
		resolveForge: ReturnType<typeof staticForge>,
	) {
		const raw = await Bun.file(
			new URL(
				"../../../packages/forge-github/fixtures/pull_request.opened.json",
				import.meta.url,
			).pathname,
		).json();
		raw.number = number;
		raw.pull_request.number = number;
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: `resume-surface-${number}`,
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent({ ...deps(), resolveForge }, { eventId });
		const run = await pool.query("SELECT id FROM runs WHERE event_id = $1", [
			eventId,
		]);
		const items = await moderationServices.listPendingItems(
			db,
			"Codertocat/Hello-World",
		);
		const item = items.find((i) => i.runId === run.rows[0].id);
		if (!item) {
			throw new Error("no pending item");
		}
		return item;
	}

	for (const [decision, number, verdict, conclusion] of [
		["approve", 9101, "pass", "success"],
		["deny", 9102, "block", "failure"],
	] as const) {
		test(`${decision} replaces the human review comment and check`, async () => {
			const forge = surfaceRecorder();
			const item = await pauseOn(number, forge.resolveForge);
			expect(forge.comments.at(-1)?.verdict).toBe("needs_review");
			expect(forge.checks.at(-1)).toBe("pending");

			await moderationServices.decideModerationItem(pool, boss, {
				itemId: item.id,
				decision,
				decidedBy: null,
			});
			await resumeRun(
				{ ...deps(), resolveForge: forge.resolveForge },
				{ itemId: item.id, decision },
			);

			expect(forge.comments.at(-1)).toMatchObject({
				verdict,
				previousVerdict: "needs_review",
			});
			expect(forge.comments.at(-1)?.body).not.toContain("human review");
			expect(forge.checks.at(-1)).toBe(conclusion);
		});
	}
});

describe("the tripwire check while a person decides", () => {
	function recordingForge() {
		const checks: { conclusion: string; summary: string }[] = [];
		const comments: string[] = [];
		const adapter = {
			execute: (action: {
				kind: string;
				body?: string;
				check?: { conclusion: string; summary: string };
			}) => {
				if (action.kind === "set-check" && action.check) {
					checks.push({
						conclusion: action.check.conclusion,
						summary: action.check.summary,
					});
				}
				if (action.kind === "comment") {
					comments.push(action.body ?? "");
				}
				return Promise.resolve({ externalId: null });
			},
		};
		return {
			checks,
			comments,
			resolveForge: staticForge({
				adapter: adapter as never,
				reads: freshReads,
			}),
		};
	}

	async function helloWorld() {
		return repoServices.ensureRepo(db, {
			externalId: "186853002",
			owner: "Codertocat",
			name: "Hello-World",
			fullName: "Codertocat/Hello-World",
		});
	}

	test("human review keeps the check pending until approve completes it", async () => {
		const forge = recordingForge();
		const item = await pauseT4Run("check-pending-1", forge.resolveForge);
		expect(forge.checks.at(-1)).toEqual({
			conclusion: "pending",
			summary: "Waiting for human review.",
		});

		await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "approve",
			decidedBy: null,
		});
		await resumeRun(
			{ ...deps(), resolveForge: forge.resolveForge },
			{ itemId: item.id, decision: "approve" },
		);
		expect(forge.checks.at(-1)?.conclusion).toBe("success");
	});

	test("a decision on an older run leaves the newer run's check alone", async () => {
		const older = await pauseT4Run("check-owner-1");
		const forge = recordingForge();
		const newer = await pauseT4Run("check-owner-2", forge.resolveForge);
		expect(newer.runId).not.toBe(older.runId);

		await moderationServices.decideModerationItem(pool, boss, {
			itemId: older.id,
			decision: "approve",
			decidedBy: null,
		});
		await resumeRun(
			{ ...deps(), resolveForge: forge.resolveForge },
			{ itemId: older.id, decision: "approve" },
		);
		expect(forge.checks.at(-1)?.conclusion).toBe("pending");
		const check = await pool.query(
			"SELECT status FROM run_actions WHERE run_id = $1 AND kind = 'set-check' AND idempotency_key LIKE '%:pass'",
			[older.runId],
		);
		expect(check.rows[0]?.status).toBe("superseded");
	});

	test("a silent repo posts no evaluating check, but completes the human review check", async () => {
		const repoId = await helloWorld();
		await repoServices.upsertResponseConfig(db, repoId, {
			...DEFAULT_RESPONSE_CONFIG,
			onSuccess: "silent",
		});
		const forge = recordingForge();
		const item = await pauseT4Run("check-silent-1", forge.resolveForge);
		expect(forge.checks).toEqual([
			{ conclusion: "pending", summary: "Waiting for human review." },
		]);

		await moderationServices.decideModerationItem(pool, boss, {
			itemId: item.id,
			decision: "approve",
			decidedBy: null,
		});
		await resumeRun(
			{ ...deps(), resolveForge: forge.resolveForge },
			{ itemId: item.id, decision: "approve" },
		);
		expect(forge.checks.at(-1)?.conclusion).toBe("success");
	});

	test("a silent pass leaves nothing on the change request, even with an old comment step", async () => {
		const repoId = await helloWorld();
		await repoServices.upsertResponseConfig(db, repoId, {
			...DEFAULT_RESPONSE_CONFIG,
			onSuccess: "silent",
		});
		await pool.query(
			"UPDATE workflow_definitions SET enabled = false WHERE repo_id = $1",
			[repoId],
		);
		await repoServices.saveWorkflowDefinition(db, repoId, {
			id: "lenient@1",
			name: "lenient",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{
					id: "age",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: 0 },
				},
				{ id: "block", type: "action", action: "block" },
				{ id: "say", type: "action", action: "comment" },
			],
			edges: [
				{ id: "e1", from: "t", to: "age" },
				{ id: "e2", from: "age", to: "block", when: "fail" },
				{ id: "e3", from: "age", to: "say" },
			],
		});
		const raw = await Bun.file(
			new URL(
				"../../../packages/forge-github/fixtures/pull_request.opened.json",
				import.meta.url,
			).pathname,
		).json();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "check-silent-pass",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		const forge = recordingForge();
		await processEvent(
			{ ...deps(), resolveForge: forge.resolveForge },
			{ eventId },
		);
		const run = await pool.query(
			"SELECT verdict FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(run.rows[0].verdict).toBe("pass");
		expect(forge.checks).toEqual([]);
		expect(forge.comments).toEqual([]);
		const stored = await pool.query(
			"SELECT 1 FROM run_actions a JOIN runs r ON r.id = a.run_id WHERE r.event_id = $1 AND a.kind = 'comment'",
			[eventId],
		);
		expect(stored.rowCount).toBe(0);
	});
});
