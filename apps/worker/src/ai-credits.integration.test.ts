import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	AI_CREDITS_COPY,
	type AiReviewOutput,
	DEFAULT_RESPONSE_CONFIG,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import type { AiReviewGenerate } from "@tripwire/core";
import {
	aiProviderServices,
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
			login: "newcomer",
			externalId: "999",
			createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
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

const outOfCredits: AiReviewGenerate = () =>
	Promise.resolve({ unavailable: "out-of-credits" });

const PASS: AiReviewOutput = {
	verdict: "pass",
	confidence: 0.9,
	summary: "a focused fix.",
	findings: [],
};
const reviews: AiReviewGenerate = () =>
	Promise.resolve({ output: PASS, trace: { steps: [] } });

function aiGate(): WorkflowDefinition {
	return {
		id: "ai-gate",
		name: "AI gate",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "age", type: "rule", ref: "account-age@1", config: { minDays: 0 } },
			{ id: "ai", type: "rule", ref: "ai-review@2", config: { maxSteps: 12 } },
			{ id: "any", type: "gate", mode: "any-of" },
			{ id: "block", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "age" },
			{ id: "e2", from: "t", to: "ai" },
			{ id: "e3", from: "age", to: "any", when: "fail" },
			{ id: "e4", from: "ai", to: "any", when: "fail" },
			{ id: "e5", from: "any", to: "block" },
		],
	};
}

async function fixtureRaw(): Promise<unknown> {
	return await Bun.file(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		).pathname,
	).json();
}

async function processWith(
	deliveryId: string,
	generate: AiReviewGenerate,
): Promise<string> {
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
			makeGenerate: () => generate,
			appUrl: "http://localhost:3000",
		},
		{ eventId },
	);
	return eventId;
}

async function runOf(eventId: string) {
	const run = await pool.query<{ id: string; verdict: string | null }>(
		"SELECT id, verdict FROM runs WHERE event_id = $1",
		[eventId],
	);
	const row = run.rows[0];
	if (!row) {
		throw new Error("no run");
	}
	return row;
}

async function aiStep(runId: string) {
	const steps = await pool.query<{ status: string; summary: string | null }>(
		"SELECT status, summary FROM run_steps WHERE run_id = $1 AND rule_id LIKE 'ai-review@%'",
		[runId],
	);
	return steps.rows[0];
}

async function commentBodies(runId: string): Promise<string[]> {
	const rows = await pool.query<{ payload: { body?: string } }>(
		"SELECT payload FROM run_actions WHERE run_id = $1 AND kind = 'comment'",
		[runId],
	);
	return rows.rows.flatMap((row) =>
		row.payload.body ? [row.payload.body] : [],
	);
}

async function checkSummaries(runId: string): Promise<string[]> {
	const rows = await pool.query<{ payload: { summary?: string } }>(
		"SELECT payload FROM run_actions WHERE run_id = $1 AND kind = 'set-check'",
		[runId],
	);
	return rows.rows.flatMap((row) =>
		row.payload.summary ? [row.payload.summary] : [],
	);
}

const exemptionBefore = process.env.TRIPWIRE_DISABLE_EXEMPTION;

beforeAll(async () => {
	delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	repoId = await repoServices.ensureRepo(db, {
		externalId: "35129377",
		owner: "Codertocat",
		name: "Hello-World",
		fullName: "Codertocat/Hello-World",
	});
	await repoServices.setRepoArmed(db, repoId, true);
}, 120_000);

afterEach(async () => {
	await pool.query("DELETE FROM workflow_definitions WHERE repo_id = $1", [
		repoId,
	]);
	await pool.query("DELETE FROM response_configs WHERE repo_id = $1", [repoId]);
	await aiProviderServices.recordAiCredits(db, "ready");
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

describe("a run whose AI review could not run for lack of credits", () => {
	test("never passes silently: it goes to human review and says AI review did not run", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, aiGate());
		const eventId = await processWith("credits-1", outOfCredits);
		const run = await runOf(eventId);
		expect(run.verdict).toBe("needs_review");
		expect(await aiStep(run.id)).toEqual({
			status: "skipped",
			summary: AI_CREDITS_COPY.notRun,
		});
		const items = await pool.query<{ node_id: string }>(
			"SELECT node_id FROM moderation_items WHERE run_id = $1",
			[run.id],
		);
		expect(items.rows.map((row) => row.node_id)).toEqual(["run:degraded"]);
		const [body] = await commentBodies(run.id);
		expect(body).toContain(AI_CREDITS_COPY.notRunShort);
		expect(await checkSummaries(run.id)).toEqual([
			`Waiting for human review. Tripwire could not finish checking. ${AI_CREDITS_COPY.notRunShort}`,
		]);
	});

	test("an approved review keeps saying AI review did not run", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, aiGate());
		const eventId = await processWith("credits-6", outOfCredits);
		const run = await runOf(eventId);
		const items = await pool.query<{ id: string }>(
			"SELECT id FROM moderation_items WHERE run_id = $1",
			[run.id],
		);
		const itemId = items.rows[0]?.id;
		if (!itemId) {
			throw new Error("no review item");
		}
		await moderationServices.decideModerationItem(pool, boss, {
			itemId,
			decision: "approve",
			decidedBy: null,
		});
		await resumeRun(
			{
				db,
				pool,
				logger,
				resolveForge: staticForge({ reads: freshReads }),
				makeGenerate: () => outOfCredits,
				appUrl: "http://localhost:3000",
			},
			{ itemId, decision: "approve" },
		);
		expect((await runOf(eventId)).verdict).toBe("pass");
		expect(await checkSummaries(run.id)).toContain(
			`Passed. ${AI_CREDITS_COPY.notRunShort}`,
		);
	});

	test("records the provider as out of credits, and a working review clears it", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, aiGate());
		await processWith("credits-2", outOfCredits);
		expect(await aiProviderServices.getAiCredits(db)).toBe("out");
		await processWith("credits-3", reviews);
		expect(await aiProviderServices.getAiCredits(db)).toBe("ready");
	});

	test("with the floor off the run passes, and still says AI review did not run", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, aiGate());
		await repoServices.upsertResponseConfig(db, repoId, {
			...DEFAULT_RESPONSE_CONFIG,
			failClosedFallback: false,
		});
		const eventId = await processWith("credits-4", outOfCredits);
		const run = await runOf(eventId);
		expect(run.verdict).toBe("pass");
		expect(await checkSummaries(run.id)).toEqual([
			`Passed. ${AI_CREDITS_COPY.notRunShort}`,
		]);
	});

	test("a block from another rule stands", async () => {
		await repoServices.saveWorkflowDefinition(db, repoId, {
			...aiGate(),
			nodes: aiGate().nodes.map((node) =>
				node.id === "age" && node.type === "rule"
					? { ...node, config: { minDays: 99_999 } }
					: node,
			),
		});
		const eventId = await processWith("credits-5", outOfCredits);
		expect((await runOf(eventId)).verdict).toBe("block");
	});
});
