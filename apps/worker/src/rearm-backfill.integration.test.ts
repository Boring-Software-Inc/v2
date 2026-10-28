import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	applyMigrations,
	BACKFILL_REPO_QUEUE,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	moderationServices,
	repoServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAction, ForgeAdapter } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import pullRequestClosed from "../../../packages/forge-github/fixtures/pull_request.closed.json";
import pullRequestOpened from "../../../packages/forge-github/fixtures/pull_request.opened.json";
import pullRequestSynchronize from "../../../packages/forge-github/fixtures/pull_request.synchronize.json";
import { staticForge } from "./forge-runtime.ts";
import { backfillRepo } from "./jobs/backfill-repo.ts";
import { processEvent } from "./jobs/process-event.ts";
import { resumeRun } from "./jobs/resume-run.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let repoId: string;
const logger = pino({ level: "silent" });
const executed: ForgeAction[] = [];
const REPO = "Codertocat/Hello-World";
const NUMBER = pullRequestOpened.number;

const MODERATED: WorkflowDefinition = {
	id: "moderated@1",
	name: "moderated gate",
	version: 1,
	nodes: [
		{
			id: "t",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
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

const adapter: ForgeAdapter = {
	forge: "github",
	verifyWebhook: () => true,
	normalizeWebhook: () => null,
	getDiff: () => Promise.resolve([]),
	getCommits: () => Promise.resolve([]),
	readFile: () => Promise.resolve(null),
	getContributorProfile: freshReads.getContributorProfile,
	execute: (action) => {
		executed.push(action);
		return Promise.resolve({ externalId: `ext-${executed.length}` });
	},
};

const deps = () => ({
	db,
	pool,
	logger,
	resolveForge: staticForge({ adapter, reads: freshReads }),
	makeGenerate: null,
	appUrl: "https://tripwire.sh",
	selfLogins: new Set<string>(),
});

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	repoId = await repoServices.ensureRepo(db, {
		externalId: "186853002",
		owner: "Codertocat",
		name: "Hello-World",
		fullName: REPO,
	});
	await repoServices.saveWorkflowDefinition(db, repoId, MODERATED);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

beforeEach(async () => {
	await drainBackfills();
	await pool.query(
		"TRUNCATE moderation_items, run_actions, run_steps, runs, events CASCADE",
	);
	await repoServices.setRepoArmed(db, repoId, false);
	executed.length = 0;
});

let delivery = 0;
type PullRequestFixture =
	| typeof pullRequestOpened
	| typeof pullRequestSynchronize
	| typeof pullRequestClosed;

async function deliver(raw: PullRequestFixture): Promise<string> {
	delivery += 1;
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId: `rearm-${delivery}`,
		rawKind: "pull_request",
		raw,
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	await processEvent(deps(), { eventId });
	return eventId;
}

async function drainBackfills(): Promise<number> {
	let ran = 0;
	for (;;) {
		const jobs = await boss.fetch<{ repoId: string }>(BACKFILL_REPO_QUEUE);
		if (jobs.length === 0) {
			return ran;
		}
		for (const job of jobs) {
			await backfillRepo(
				{ db, pool, reads: freshReads, makeGenerate: null, logger },
				job.data,
			);
			await boss.complete(BACKFILL_REPO_QUEUE, job.id);
			ran += 1;
		}
	}
}

async function runsOfChangeRequest() {
	return await runServices.listRunsForChangeRequest(
		db,
		{ forge: "github", fullName: REPO },
		NUMBER,
	);
}

async function approveOnlyPendingItem(): Promise<string> {
	const items = await moderationServices.listPendingItems(db, [
		{ forge: "github", fullName: REPO },
	]);
	expect(items).toHaveLength(1);
	const item = items[0];
	if (!item) {
		throw new Error("no pending item");
	}
	await moderationServices.decideModerationItem(pool, boss, {
		itemId: item.id,
		decision: "approve",
		decidedBy: null,
	});
	await resumeRun(deps(), { itemId: item.id, decision: "approve" });
	return item.runId;
}

function checksExecuted(): string[] {
	return executed.flatMap((action) =>
		action.kind === "set-check" ? [action.check.conclusion] : [],
	);
}

function commentsExecuted(): string[] {
	return executed.flatMap((action) =>
		action.kind === "comment" ? [action.body] : [],
	);
}

describe("turning on a gate that is already on", () => {
	test("queues no backfill, so the approved review reaches the change request", async () => {
		await repoServices.turnOnGate(db, async () => boss, repoId);
		expect(await drainBackfills()).toBe(1);

		await deliver(pullRequestOpened);
		expect(await runsOfChangeRequest()).toHaveLength(1);

		await repoServices.turnOnGate(db, async () => boss, repoId);
		await repoServices.turnOnGate(db, async () => boss, repoId);
		expect(await drainBackfills()).toBe(0);
		expect(await runsOfChangeRequest()).toHaveLength(1);
		expect(
			await moderationServices.listPendingItems(db, [
				{ forge: "github", fullName: REPO },
			]),
		).toHaveLength(1);

		executed.length = 0;
		const runId = await approveOnlyPendingItem();
		const run = await runServices.getRunById(db, runId);
		expect(run?.status).toBe("completed");
		expect(run?.verdict).toBe("pass");
		expect(checksExecuted()).toEqual(["success"]);
		expect(commentsExecuted()).toHaveLength(1);
		const superseded = (await runServices.listRunActions(db, runId)).filter(
			(action) => action.status === "superseded",
		);
		expect(superseded).toEqual([]);

		executed.length = 0;
		await deliver(pullRequestClosed);
		expect((await runServices.getRunById(db, runId))?.status).toBe("completed");
		expect(commentsExecuted().join("\n")).not.toContain("closed before review");
		expect(checksExecuted()).not.toContain("neutral");
	});
});

describe("turning a gate off and on again", () => {
	test("the backfill skips an event that already has a run", async () => {
		await repoServices.turnOnGate(db, async () => boss, repoId);
		await drainBackfills();
		await deliver(pullRequestOpened);

		await repoServices.setRepoArmed(db, repoId, false);
		await repoServices.turnOnGate(db, async () => boss, repoId);
		expect(await drainBackfills()).toBe(1);

		expect(await runsOfChangeRequest()).toHaveLength(1);
		expect(
			await moderationServices.listPendingItems(db, [
				{ forge: "github", fullName: REPO },
			]),
		).toHaveLength(1);
	});

	test("an event stored while off replays as history and never takes the live run's surfaces", async () => {
		await repoServices.turnOnGate(db, async () => boss, repoId);
		await drainBackfills();
		await deliver(pullRequestOpened);

		await repoServices.setRepoArmed(db, repoId, false);
		await deliver(pullRequestSynchronize);
		expect(await runsOfChangeRequest()).toHaveLength(1);

		await repoServices.turnOnGate(db, async () => boss, repoId);
		expect(await drainBackfills()).toBe(1);

		const runs = await runsOfChangeRequest();
		expect(runs).toHaveLength(1);
		const replayed = await pool.query<{ status: string; verdict: string }>(
			"SELECT status, verdict FROM runs WHERE repo_full_name = $1 AND backfill = true",
			[REPO],
		);
		expect(replayed.rows).toEqual([
			{ status: "completed", verdict: "needs_review" },
		]);
		expect(
			await moderationServices.listPendingItems(db, [
				{ forge: "github", fullName: REPO },
			]),
		).toHaveLength(1);
		expect(
			await runServices.getLatestRunIdForChangeRequest(
				db,
				{ forge: "github", fullName: REPO },
				NUMBER,
			),
		).toBe(runs[0]?.id ?? "");

		executed.length = 0;
		const runId = await approveOnlyPendingItem();
		expect(runId).toBe(runs[0]?.id ?? "");
		expect(checksExecuted()).toEqual(["success"]);
		expect(commentsExecuted()).toHaveLength(1);

		executed.length = 0;
		await deliver(pullRequestClosed);
		expect(commentsExecuted().join("\n")).not.toContain("closed before review");
	});
});
