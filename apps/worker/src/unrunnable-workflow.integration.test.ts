import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	repoServices,
	type TestDatabase,
	turnOnLegacyRules,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { staticForge } from "./forge-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let repoId: string;
const logger = pino({ level: "silent" });

const freshReads = {
	getDiff: () =>
		Promise.resolve([
			{
				path: "src/app.ts",
				status: "modified" as const,
				additions: 3,
				deletions: 1,
			},
		]),
	getCommits: () => Promise.resolve([]),
	getContributorProfile: () =>
		Promise.resolve({
			login: "sockpuppet",
			externalId: "999",
			createdAt: new Date(
				Date.now() - 2 * 86_400_000 - 3_600_000,
			).toISOString(),
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

async function fixtureRaw(): Promise<unknown> {
	return await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		).pathname,
	).json();
}

async function processFresh(deliveryId: string): Promise<string> {
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind: "pull_request",
		raw: await fixtureRaw(),
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	await processEvent(
		{
			db,
			pool,
			logger,
			resolveForge: staticForge({ reads: freshReads }),
			makeGenerate: null,
			appUrl: "http://localhost:3000",
		},
		{ eventId },
	);
	return eventId;
}

async function runOf(eventId: string) {
	const run = await pool.query(
		"SELECT id, verdict, status FROM runs WHERE event_id = $1",
		[eventId],
	);
	return run.rows[0] as
		| { id: string; verdict: string | null; status: string }
		| undefined;
}

async function ruleSteps(eventId: string) {
	const run = await pool.query("SELECT id FROM runs WHERE event_id = $1", [
		eventId,
	]);
	const steps = await pool.query(
		"SELECT rule_id, status, evidence FROM run_steps WHERE run_id = $1 AND node_kind = 'rule'",
		[run.rows[0].id],
	);
	return steps.rows as { rule_id: string; status: string; evidence: unknown }[];
}

const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;

beforeAll(async () => {
	// Pin the exemption flag OFF — ambient env must not affect the derived run
	// (VERIFICATION-QUEUE #10 root cause: env contamination).
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	// The pull_request.opened fixture is scoped to Codertocat/Hello-World.
	repoId = await repoServices.ensureRepo(db, {
		externalId: "35129377",
		owner: "Codertocat",
		name: "Hello-World",
		fullName: "Codertocat/Hello-World",
	});
	// §4 arming — these tests assert real runs, so the repo must be armed.
	await repoServices.setRepoArmed(db, repoId, true);
}, 120_000);

afterEach(async () => {
	await pool.query("DELETE FROM rule_configs WHERE repo_id = $1", [repoId]);
	await pool.query("DELETE FROM workflow_definitions WHERE repo_id = $1", [
		repoId,
	]);
});

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

function brokenWorkflow(): WorkflowDefinition {
	return {
		id: "broken-live",
		name: "Broken live",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r1", type: "rule", ref: "account-age@1", config: { minDays: 0 } },
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r1" },
			{ id: "e2", from: "r1", to: "block", when: "fail" },
			{ id: "stale", from: "r1", to: "deleted-step", when: "fail" },
		],
	};
}

describe("a live workflow the worker cannot run", () => {
	test("is recorded on the run and sends it to human review", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, brokenWorkflow());
		const eventId = await processFresh("unrunnable-1");
		const run = await runOf(eventId);
		expect(run?.verdict).toBe("needs_review");
		const steps = await pool.query(
			"SELECT node_id, status, output FROM run_steps WHERE run_id = $1 AND node_id = 'run:unrunnable'",
			[run?.id],
		);
		expect(steps.rows).toHaveLength(1);
		expect(steps.rows[0].output.workflows).toEqual([
			{ id: "broken-live", name: "Broken live" },
		]);
		const items = await pool.query(
			"SELECT node_id FROM moderation_items WHERE run_id = $1",
			[run?.id],
		);
		expect(items.rows.map((row) => row.node_id)).toEqual(["run:degraded"]);
	});

	test("keeps owning its rules, so they do not fall back to the toggles", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, brokenWorkflow());
		await turnOnLegacyRules(db, repoId);
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: true,
			config: { minDays: 9999 },
		});
		const eventId = await processFresh("unrunnable-2");
		const refs = (await ruleSteps(eventId)).map((step) => step.rule_id);
		expect(refs).not.toContain("account-age@1");
		expect(refs).toContain("crypto-address@2");
	});
});
