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
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { processEvent } from "./jobs/process-event.ts";

/**
 * §6 toggles are REAL (live-test surprise #1): the worker reads rule_configs.
 * Derived path — disabled rules drop from the graph, config edits flow through;
 * saved path — a disabled rule's node records `skipped: disabled`.
 */
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
			adapter: null,
			makeGenerate: null,
			appUrl: "http://localhost:3000",
			reads: freshReads,
		},
		{ eventId },
	);
	return eventId;
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

describe("toggles → derived default workflow", () => {
	test("toggle OFF ⇒ rule absent from the derived run", async () => {
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: false,
			config: { minDays: 7 },
		});
		const eventId = await processFresh("toggle-off-1");
		const steps = await ruleSteps(eventId);
		const refs = steps.map((s) => s.rule_id);
		expect(refs).not.toContain("account-age@1");
		// baseline siblings still ran (proves it's a targeted drop, not empty).
		expect(refs).toContain("crypto-address@1");
	});

	test("ai-review is opt-in: absent ⇒ not in the run; enabled but keyless ⇒ skipped step (§8)", async () => {
		// No ai-review row ⇒ non-baseline ⇒ absent from the derived default.
		const absent = await processFresh("aireview-absent");
		expect(
			(await ruleSteps(absent)).some((s) =>
				s.rule_id?.startsWith("ai-review@"),
			),
		).toBe(false);

		// Opted in at version 1, but §6 (b) auto-advances a lossless config to the
		// current version — so this runs as ai-review@2 (config {maxSteps} carries
		// forward), NOT @1. processFresh runs with makeGenerate: null (no key) ⇒
		// the node evaluates and SKIPS (counts toward the floor).
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "ai-review",
			version: 1,
			enabled: true,
			config: { maxSteps: 12 },
		});
		const optedIn = await processFresh("aireview-optin-nokey");
		const steps = await ruleSteps(optedIn);
		expect(steps.map((s) => s.rule_id)).toContain("ai-review@2");
		expect(steps.map((s) => s.rule_id)).not.toContain("ai-review@1");
		const ai = steps.find((s) => s.rule_id === "ai-review@2");
		expect(ai?.status).toBe("skipped");
	});

	test("config edit in rule_configs ⇒ reflected in the derived run's evidence", async () => {
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: true,
			config: { minDays: 9999 },
		});
		const eventId = await processFresh("toggle-config-1");
		const steps = await ruleSteps(eventId);
		const age = steps.find((s) => s.rule_id === "account-age@1");
		expect(age?.status).toBe("fail");
		expect(
			(age?.evidence as { evidence: { minDays: number } }).evidence.minDays,
		).toBe(9999);
	});
});

describe("toggles → workflow-owned rule enablement (§6)", () => {
	test("a rule in a saved workflow evaluates even when its /rules toggle is OFF", async () => {
		const saved: WorkflowDefinition = {
			id: "live-test@1",
			name: "saved",
			version: 1,
			nodes: [
				{
					id: "t",
					type: "trigger",
					kinds: ["change-request.opened", "change-request.updated"],
				},
				{
					id: "r1",
					type: "rule",
					ref: "account-age@1",
					// minDays 0 ⇒ any account passes; the point is that the node
					// RUNS despite the toggle being off, not the verdict direction.
					config: { minDays: 0 },
				},
				{ id: "r2", type: "rule", ref: "crypto-address@1", config: {} },
				{ id: "g", type: "gate", mode: "all-of" },
				{ id: "block", type: "action", action: "block" },
			],
			edges: [
				{ id: "e1", from: "t", to: "r1" },
				{ id: "e2", from: "t", to: "r2" },
				{ id: "e3", from: "r1", to: "g" },
				{ id: "e4", from: "r2", to: "g" },
				{ id: "e5", from: "g", to: "block", when: "fail" },
			],
		};
		await repoServices.saveWorkflowDefinition(db, repoId, saved);
		// The standalone toggle is OFF — under the model this does NOT gate the
		// workflow's copy; the workflow owns it.
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: false,
			config: { minDays: 7 },
		});
		const eventId = await processFresh("workflow-owned-1");
		const steps = await ruleSteps(eventId);
		const age = steps.find((s) => s.rule_id === "account-age@1");
		// It evaluated — the workflow node's config (minDays 0) ran, and it was
		// never skipped as `disabled` by the toggle.
		expect(age?.status).toBe("pass");
		const run = await pool.query(
			"SELECT verdict FROM runs WHERE event_id = $1",
			[eventId],
		);
		expect(run.rows[0].verdict).toBe("pass");
	});
});
