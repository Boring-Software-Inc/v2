import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SCHEDULE_TICK_MS, type WorkflowDefinition } from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	scheduleServices,
	type TestDatabase,
	workflowServices,
} from "@tripwire/db";
import type {
	ContributorProfile,
	ForgeAction,
	ForgeThread,
	ThreadListQuery,
} from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import type { WorkerReads } from "./context.ts";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";
import { scheduleTick, scheduleTickId } from "./jobs/schedule-tick.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });
const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;

const REPO = "Codertocat/Hello-World";
const QUIET = "Codertocat/Quiet";
const T0 = new Date("2026-10-22T12:01:00.000Z");
const HOUR = 60 * 60_000;
const EVERY_12H = { n: 12, unit: "hours" } as const;
const firstTick = {
	schedule: {
		every: EVERY_12H,
		match: {
			subjects: ["issue" as const],
			state: "open" as const,
			inactiveFor: { n: 15, unit: "days" as const },
			skipLocked: true,
		},
	},
	lastTickAt: null,
};

const THREADS: ForgeThread[] = [
	{
		kind: "issue",
		number: 1,
		title: "Spelling error in the README file",
		url: "https://github.com/Codertocat/Hello-World/issues/1",
		state: "closed",
		author: "Codertocat",
		authorExternalId: "21031067",
		authorAvatarUrl: "https://avatars1.githubusercontent.com/u/21031067?v=4",
		labels: ["bug"],
		locked: false,
		updatedAt: "2026-09-01T10:00:00.000Z",
	},
	{
		kind: "change-request",
		number: 2,
		title: "Update the README with new information.",
		url: "https://github.com/Codertocat/Hello-World/pull/2",
		state: "open",
		author: "Codertocat",
		authorExternalId: "21031067",
		labels: [],
		locked: false,
		updatedAt: "2026-09-02T10:00:00.000Z",
	},
];

const SCHEDULED: WorkflowDefinition = {
	id: "wf-lock-inactive",
	name: "Lock inactive threads",
	version: 1,
	nodes: [
		{
			id: "every-12h",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: { n: 12, unit: "hours" },
				match: {
					subjects: ["issue", "change-request"],
					state: "any",
					inactiveFor: { n: 15, unit: "days" },
					skipLocked: true,
				},
			},
		},
		{
			id: "old-account",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		},
		{
			id: "lock",
			type: "action",
			action: "lock",
			params: { reason: "resolved" },
		},
		{ id: "close", type: "action", action: "close" },
		{
			id: "ask",
			type: "action",
			action: "request-review",
			params: { reviewers: [{ login: "hubot" }] },
		},
		{
			id: "warn",
			type: "action",
			action: "post-comment",
			params: { message: "Locking this after 15 days with no activity." },
		},
		{
			id: "unmark",
			type: "action",
			action: "remove-label",
			params: { labels: ["needs triage"] },
		},
	],
	edges: [
		{ id: "e1", from: "every-12h", to: "old-account" },
		{ id: "e2", from: "old-account", to: "lock" },
		{ id: "e3", from: "every-12h", to: "close" },
		{ id: "e4", from: "every-12h", to: "ask" },
		{ id: "e5", from: "every-12h", to: "warn" },
		{ id: "e6", from: "every-12h", to: "unmark" },
	],
};

const EVENT_DRIVEN: WorkflowDefinition = {
	id: "wf-events",
	name: "Label new change requests",
	version: 1,
	nodes: [
		{
			id: "t",
			type: "trigger",
			kinds: ["change-request.opened"],
		},
		{
			id: "label",
			type: "action",
			action: "label",
			params: { labels: ["new"] },
		},
	],
	edges: [{ id: "e1", from: "t", to: "label" }],
};

const queries: { repo: string; query: ThreadListQuery }[] = [];
const executed: ForgeAction[] = [];

const adapter = {
	forge: "github" as const,
	verifyWebhook: () => true,
	normalizeWebhook: () => null,
	getDiff: () => Promise.reject(new Error("unused")),
	getCommits: () => Promise.reject(new Error("unused")),
	readFile: () => Promise.resolve(null),
	getContributorProfile: () => Promise.reject(new Error("unused")),
	execute: (action: ForgeAction) => {
		executed.push(action);
		return Promise.resolve({ externalId: null });
	},
};

const profile: ContributorProfile = {
	login: "Codertocat",
	externalId: "21031067",
	createdAt: "2019-01-01T00:00:00.000Z",
	followers: 10,
	following: 1,
	publicRepos: 8,
	profileText: null,
	mergedInRepo: 3,
	mergedElsewhere: 2,
	recentChangeRequestTimes: [],
	isOrgMember: true,
	isMaintainer: true,
};

const reads: WorkerReads = {
	getDiff: () => Promise.reject(new Error("no diff for a scheduled run")),
	getCommits: () => Promise.reject(new Error("no commits for a scheduled run")),
	getContributorProfile: () => Promise.resolve(profile),
};

const resolveForge = staticForge({
	adapter,
	reads,
	listThreads: (repo, query) => {
		queries.push({ repo, query });
		return Promise.resolve({ threads: THREADS, stopped: null });
	},
});

let scheduledRowId = "";

async function enableWorkflow(repoId: string, definition: WorkflowDefinition) {
	const row = await workflowServices.createWorkflow(db, {
		repoId,
		name: definition.name,
		definition,
	});
	const enabled = await workflowServices.setWorkflowEnabled(db, {
		repoId,
		workflowId: row.id,
		enabled: true,
	});
	expect(enabled.ok).toBe(true);
	return row.id;
}

async function processPending(): Promise<void> {
	const rows = await pool.query(
		"SELECT id FROM events WHERE raw_kind = 'schedule.matched' AND normalized_at IS NULL ORDER BY id",
	);
	for (const row of rows.rows) {
		await processEvent(
			{
				db,
				pool,
				logger,
				resolveForge,
				makeGenerate: null,
				appUrl: "http://localhost:3000",
			},
			{ eventId: row.id },
		);
	}
}

function tick(now: Date) {
	return scheduleTick({
		db,
		pool,
		boss,
		resolveForge,
		logger,
		now: () => now,
	});
}

beforeAll(async () => {
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	const repoId = await repoServices.ensureRepo(db, {
		externalId: "186853002",
		owner: "Codertocat",
		name: "Hello-World",
		fullName: REPO,
		installationId: "2311213",
	});
	await repoServices.setRepoArmed(db, repoId, true);
	scheduledRowId = await enableWorkflow(repoId, SCHEDULED);
	await enableWorkflow(repoId, EVENT_DRIVEN);

	const quietId = await repoServices.ensureRepo(db, {
		externalId: "186853003",
		owner: "Codertocat",
		name: "Quiet",
		fullName: QUIET,
		installationId: "2311213",
	});
	await enableWorkflow(quietId, { ...SCHEDULED, id: "wf-quiet" });
	await pool.query("DELETE FROM workflow_schedule_state");
}, 120_000);

afterAll(async () => {
	if (exemptionBefore === undefined) {
		delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	} else {
		process.env.TRIPWIRE_DISABLE_EXEMPTION = exemptionBefore;
	}
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("schedule tick", () => {
	test("a due schedule makes one event per matched thread, armed repos only", async () => {
		const result = await tick(T0);
		expect(result).toEqual({ schedules: 1, events: 2, errors: 0 });
		expect(queries).toEqual([
			{
				repo: REPO,
				query: {
					subjects: ["issue", "change-request"],
					state: "any",
					updatedBefore: new Date(T0.getTime() - 15 * 24 * HOUR).toISOString(),
					labels: [],
					excludeLabels: [],
					skipLocked: true,
					cap: 100,
				},
			},
		]);
		const events = await pool.query(
			"SELECT delivery_id, forge FROM events WHERE raw_kind = 'schedule.matched' ORDER BY delivery_id",
		);
		const tickId = scheduleTickId(firstTick, T0);
		expect(events.rows).toEqual([
			{
				delivery_id: `schedule:wf-lock-inactive:every-12h:1:${tickId}`,
				forge: "github",
			},
			{
				delivery_id: `schedule:wf-lock-inactive:every-12h:2:${tickId}`,
				forge: "github",
			},
		]);
		const state = await scheduleServices.getScheduleState(
			db,
			scheduledRowId,
			"every-12h",
		);
		expect(state?.lastTickAt.toISOString()).toBe("2026-10-22T12:00:00.000Z");
		expect(state?.lastError).toBeNull();
	});

	test("each event runs only the scheduling workflow and acts on the thread", async () => {
		await processPending();
		const runs = await pool.query(
			"SELECT id, subject_number, subject_kind, head_sha, status, verdict, workflow_snapshot FROM runs ORDER BY subject_number",
		);
		expect(runs.rows).toHaveLength(2);
		for (const run of runs.rows) {
			expect(
				run.workflow_snapshot.map((def: { id: string }) => def.id),
			).toEqual(["wf-lock-inactive"]);
			expect(run.head_sha).toBeNull();
			expect(run.status).toBe("completed");
			expect(run.verdict).toBe("pass");
		}
		expect(
			runs.rows.map((run) => [run.subject_number, run.subject_kind]),
		).toEqual([
			[1, "issue"],
			[2, "change-request"],
		]);

		const actions = await pool.query(
			`SELECT r.subject_number, a.kind, a.status FROM run_actions a
			 JOIN runs r ON r.id = a.run_id ORDER BY r.subject_number, a.kind`,
		);
		expect(
			actions.rows.map(
				(row) => `${row.subject_number}:${row.kind}:${row.status}`,
			),
		).toEqual([
			"1:close:executed",
			"1:lock:executed",
			"1:post-comment:executed",
			"1:remove-label:executed",
			"1:request-review:superseded",
			"2:close:executed",
			"2:lock:executed",
			"2:post-comment:executed",
			"2:remove-label:executed",
			"2:request-review:executed",
		]);

		const runIds = new Map<number, string>(
			runs.rows.map((run) => [run.subject_number, run.id]),
		);
		for (const number of [1, 2]) {
			expect(executed).toContainEqual({
				kind: "post-comment",
				repoFullName: REPO,
				number,
				body: "Locking this after 15 days with no activity.",
				marker: `<!-- tripwire:comment wf-lock-inactive/warn run=${runIds.get(number)} -->`,
			});
			expect(executed).toContainEqual({
				kind: "remove-label",
				repoFullName: REPO,
				number,
				labels: ["needs triage"],
			});
		}

		expect(executed).toEqual(
			expect.arrayContaining([
				{
					kind: "lock",
					repoFullName: REPO,
					number: 1,
					reason: "resolved",
				},
				{ kind: "close", repoFullName: REPO, number: 1 },
				{
					kind: "lock",
					repoFullName: REPO,
					number: 2,
					reason: "resolved",
				},
				{ kind: "close", repoFullName: REPO, number: 2 },
				{
					kind: "request-review",
					repoFullName: REPO,
					number: 2,
					reviewers: ["hubot"],
					teamReviewers: [],
				},
			]),
		);
		expect(executed).toHaveLength(9);
		expect(
			executed.filter((action) =>
				["set-check", "comment", "block", "update-review"].includes(
					action.kind,
				),
			),
		).toEqual([]);
	});

	test("re-ticking inside the same tick id inserts nothing new", async () => {
		await pool.query("DELETE FROM workflow_schedule_state");
		const result = await tick(new Date(T0.getTime() + 2 * HOUR));
		expect(result).toEqual({ schedules: 1, events: 0, errors: 0 });
		const count = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE raw_kind = 'schedule.matched'",
		);
		expect(count.rows[0].n).toBe(2);
	});

	test("a schedule that is not due is skipped", async () => {
		const before = queries.length;
		const result = await tick(new Date(T0.getTime() + 13 * HOUR));
		expect(result.schedules).toBe(0);
		expect(queries.length).toBe(before);
	});

	test("the next tick window runs again with a new tick id", async () => {
		const later = new Date(T0.getTime() + 26 * HOUR);
		const result = await tick(later);
		expect(result).toEqual({ schedules: 1, events: 2, errors: 0 });
		expect(scheduleTickId(firstTick, later)).not.toBe(
			scheduleTickId(firstTick, T0),
		);
	});

	test("a failed listing records the error and keeps the tick due", async () => {
		const before = await scheduleServices.getScheduleState(
			db,
			scheduledRowId,
			"every-12h",
		);
		const failing = staticForge({
			adapter,
			listThreads: () => Promise.reject(new Error("GET issues failed: 502")),
		});
		const at = new Date(T0.getTime() + 40 * HOUR);
		const result = await scheduleTick({
			db,
			pool,
			boss,
			resolveForge: failing,
			logger,
			now: () => at,
		});
		expect(result).toEqual({ schedules: 1, events: 0, errors: 1 });
		const state = await scheduleServices.getScheduleState(
			db,
			scheduledRowId,
			"every-12h",
		);
		expect(state?.lastTickAt.toISOString()).toBe(
			before?.lastTickAt.toISOString(),
		);
		expect(state?.lastError).toContain("502");
	});

	test("the sweeper retries a stuck lock and close against the thread", async () => {
		await pool.query(
			`UPDATE run_actions SET status = 'recorded', executed_at = NULL
			 WHERE kind IN ('lock', 'close') AND run_id IN (SELECT id FROM runs WHERE subject_number = 1)`,
		);
		executed.length = 0;
		const result = await sweepActions(
			{
				db,
				adapterFor: () => Promise.resolve(adapter),
				logger,
				appUrl: "http://localhost:3000",
			},
			{
				recordedBefore: new Date(Date.now() + 60_000),
				giveUpBefore: new Date(Date.now() - 60 * 60_000),
			},
		);
		expect(result.executed).toBeGreaterThanOrEqual(2);
		expect(executed).toEqual(
			expect.arrayContaining([
				{ kind: "lock", repoFullName: REPO, number: 1, reason: "resolved" },
				{ kind: "close", repoFullName: REPO, number: 1 },
			]),
		);
		expect(executed.some((action) => action.kind === "block")).toBe(false);
	});

	test("a rate limit keeps what was read, records why, and keeps the tick due", async () => {
		const before = await scheduleServices.getScheduleState(
			db,
			scheduledRowId,
			"every-12h",
		);
		const limited = staticForge({
			adapter,
			listThreads: () =>
				Promise.resolve({
					threads: [{ ...THREADS[0], number: 9 } as ForgeThread],
					stopped: "rate-limit",
				}),
		});
		const at = new Date(T0.getTime() + 60 * HOUR);
		const result = await scheduleTick({
			db,
			pool,
			boss,
			resolveForge: limited,
			logger,
			now: () => at,
		});
		expect(result).toEqual({ schedules: 1, events: 1, errors: 1 });
		const state = await scheduleServices.getScheduleState(
			db,
			scheduledRowId,
			"every-12h",
		);
		expect(state?.lastError).toContain("rate limited");
		expect(state?.lastTickAt.toISOString()).toBe(
			before?.lastTickAt.toISOString(),
		);

		const recovered = staticForge({
			adapter,
			listThreads: () =>
				Promise.resolve({
					threads: [
						{ ...THREADS[0], number: 9 } as ForgeThread,
						{ ...THREADS[0], number: 10 } as ForgeThread,
					],
					stopped: null,
				}),
		});
		const retried = await scheduleTick({
			db,
			pool,
			boss,
			resolveForge: recovered,
			logger,
			now: () => new Date(at.getTime() + 5 * 60_000),
		});
		expect(retried).toEqual({ schedules: 1, events: 1, errors: 0 });
		const cleared = await scheduleServices.getScheduleState(
			db,
			scheduledRowId,
			"every-12h",
		);
		expect(cleared?.lastError).toBeNull();
	});

	test("a scheduled run whose rules mostly skip takes no action and asks no one", async () => {
		const staleRepo = "Codertocat/Stale";
		const staleId = await repoServices.ensureRepo(db, {
			externalId: "186853004",
			owner: "Codertocat",
			name: "Stale",
			fullName: staleRepo,
			installationId: "2311213",
		});
		await repoServices.setRepoArmed(db, staleId, true);
		await enableWorkflow(staleId, {
			id: "wf-needs-diff",
			name: "Lock big inactive threads",
			version: 1,
			nodes: [
				{
					...SCHEDULED.nodes[0],
					id: "nightly",
				} as WorkflowDefinition["nodes"][number],
				{
					id: "files",
					type: "rule",
					ref: "max-files-changed@1",
					config: { max: 200 },
				},
				{
					id: "lock",
					type: "action",
					action: "lock",
					params: { reason: "resolved" },
				},
			],
			edges: [
				{ id: "e1", from: "nightly", to: "files" },
				{ id: "e2", from: "files", to: "lock" },
			],
		});
		const at = new Date(T0.getTime() + 61 * HOUR);
		const result = await tick(at);
		expect(result.schedules).toBe(1);
		executed.length = 0;
		await processPending();

		const runs = await pool.query(
			"SELECT id, status, verdict FROM runs WHERE repo_full_name = $1",
			[staleRepo],
		);
		expect(runs.rows).toHaveLength(2);
		for (const run of runs.rows) {
			expect(run.status).toBe("completed");
			const actions = await pool.query(
				"SELECT kind FROM run_actions WHERE run_id = $1",
				[run.id],
			);
			expect(actions.rows).toEqual([]);
			const items = await pool.query(
				"SELECT id FROM moderation_items WHERE run_id = $1",
				[run.id],
			);
			expect(items.rows).toEqual([]);
			const step = await pool.query(
				"SELECT output FROM run_steps WHERE run_id = $1 AND node_id = 'run:degradation'",
				[run.id],
			);
			expect(step.rows[0]?.output).toMatchObject({
				skippedRules: 1,
				ruleNodes: 1,
				tookNoAction: true,
			});
		}
		expect(
			executed.filter((action) => action.repoFullName === staleRepo),
		).toEqual([]);
	});
});

describe("a schedule starts over when it turns on or its timing changes (R8-2)", () => {
	const RESTART_REPO = "Codertocat/Restart";
	let repoId = "";
	const now = new Date();
	const hourAgo = new Date(now.getTime() - HOUR);
	const stale = new Date(now.getTime() - 3 * HOUR);
	const dailyAt = (at: Date, shift = 0) =>
		`${(at.getUTCMinutes() + shift) % 60} ${at.getUTCHours()} * * *`;

	function cronWorkflow(id: string, cron: string): WorkflowDefinition {
		return {
			...SCHEDULED,
			id,
			name: id,
			nodes: [
				{
					...SCHEDULED.nodes[0],
					schedule: {
						...(SCHEDULED.nodes[0] as { schedule: object }).schedule,
						every: { cron },
					},
				} as WorkflowDefinition["nodes"][number],
				...SCHEDULED.nodes.slice(1),
			],
		};
	}

	async function due(rowId: string, at: Date): Promise<boolean> {
		const list = await scheduleServices.listDueSchedules(db, at);
		return list.some((entry) => entry.workflowRowId === rowId);
	}

	async function markStale(rowId: string) {
		await scheduleServices.markScheduleTicked(db, {
			workflowRowId: rowId,
			nodeId: "every-12h",
			at: stale,
			error: null,
		});
	}

	beforeAll(async () => {
		repoId = await repoServices.ensureRepo(db, {
			externalId: "186853005",
			owner: "Codertocat",
			name: "Restart",
			fullName: RESTART_REPO,
			installationId: "2311213",
		});
		await repoServices.setRepoArmed(db, repoId, true);
	});

	test("a stale tick still owes the run it missed, as before", async () => {
		const rowId = await enableWorkflow(
			repoId,
			cronWorkflow("wf-stale", dailyAt(hourAgo)),
		);
		await markStale(rowId);
		expect(await due(rowId, now)).toBe(true);
	});

	test("turning it on again after a stale tick replays nothing", async () => {
		const rowId = await enableWorkflow(
			repoId,
			cronWorkflow("wf-reenable", dailyAt(hourAgo)),
		);
		await workflowServices.setWorkflowEnabled(db, {
			repoId,
			workflowId: rowId,
			enabled: false,
		});
		await markStale(rowId);
		await workflowServices.setWorkflowEnabled(db, {
			repoId,
			workflowId: rowId,
			enabled: true,
		});
		expect(await due(rowId, new Date())).toBe(false);
		expect(await due(rowId, new Date(now.getTime() + 24 * HOUR))).toBe(true);
	});

	test("saving a new schedule starts over, saving the same one does not", async () => {
		const definition = cronWorkflow("wf-edit", dailyAt(hourAgo));
		const rowId = await enableWorkflow(repoId, definition);
		await markStale(rowId);
		const renamed = await workflowServices.saveWorkflowDefinition(db, {
			repoId,
			workflowId: rowId,
			definition: { ...definition, name: "wf-edit-renamed" },
		});
		expect(renamed.ok).toBe(true);
		expect(await due(rowId, now)).toBe(true);

		const saved = await workflowServices.saveWorkflowDefinition(db, {
			repoId,
			workflowId: rowId,
			definition: cronWorkflow("wf-edit", dailyAt(hourAgo, 1)),
		});
		expect(saved.ok).toBe(true);
		expect(await due(rowId, new Date())).toBe(false);
	});

	test("a pushed schedule change starts over too", async () => {
		const definition = cronWorkflow("wf-push", dailyAt(hourAgo));
		const rowId = await enableWorkflow(repoId, definition);
		await markStale(rowId);
		const pushed = await workflowServices.applyWorkflowDefinition(db, {
			repoId,
			definition: cronWorkflow("wf-push", dailyAt(hourAgo, 2)),
		});
		expect(pushed.ok).toBe(true);
		expect(await due(rowId, new Date())).toBe(false);
	});

	test("an interval turned on runs at the first tick slot after it turns on", async () => {
		const before = Date.now();
		const rowId = await enableWorkflow(repoId, {
			...SCHEDULED,
			id: "wf-interval-restart",
			name: "wf-interval-restart",
		});
		const state = await scheduleServices.getScheduleState(
			db,
			rowId,
			"every-12h",
		);
		const turnedOn = (state?.lastTickAt.getTime() ?? 0) + 12 * HOUR;
		expect(turnedOn).toBeGreaterThanOrEqual(before);
		expect(turnedOn).toBeLessThanOrEqual(Date.now());
		const slot = Math.ceil(turnedOn / SCHEDULE_TICK_MS) * SCHEDULE_TICK_MS;
		expect(await due(rowId, new Date(slot - 1))).toBe(slot === turnedOn);
		expect(await due(rowId, new Date(slot + 34_000))).toBe(true);
	});
});
