import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { aiReviewUsage } from "../schema/economics.ts";
import { events } from "../schema/events.ts";
import { repos } from "../schema/repos.ts";
import { runSteps, runs } from "../schema/runs.ts";
import {
	backfillAiReviewUsage,
	getLastCreditBalance,
	recordAiReviewUsage,
	recordRunAiReviewUsage,
	recordUsageCounters,
	upsertProviderCost,
} from "./economics.ts";

/**
 * Economics metering (economics-surface-contracts.md). Backfill reads real
 * stored traces of two shapes (bounded + raw AI SDK) and skips seed traces;
 * live writers are idempotent on their grain. Real Postgres — the constraints
 * ARE the logic.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = "acme/economics";
const ORG = "org_econ";

function envelope(trace: unknown) {
	return {
		status: "evaluated",
		passed: false,
		ruleId: "ai-review",
		version: 2,
		evidence: { output: { verdict: "block" }, trace },
		evaluatedAt: "2026-07-21T14:22:07.000Z",
	};
}

async function seedStep(input: {
	runId: string;
	ruleId: string | null;
	evidence: unknown;
}): Promise<string> {
	const id = generateId();
	const started = new Date("2026-07-21T14:22:00.000Z");
	await db.insert(runSteps).values({
		id,
		runId: input.runId,
		nodeId: `wf:${input.ruleId ?? "gate"}`,
		nodeKind: input.ruleId ? "rule" : "gate",
		ruleId: input.ruleId,
		status: "evaluated",
		evidence: input.evidence,
		startedAt: started,
		finishedAt: started,
		durationMs: 1200,
	});
	return id;
}

beforeAll(async () => {
	container = await createTestDatabase();
	const created = createDb(container.url);
	db = created.db;
	pool = created.pool;
	await applyMigrations(db);

	await db.insert(repos).values({
		id: generateId(),
		externalId: "1",
		owner: "acme",
		name: "economics",
		fullName: REPO,
		orgId: ORG,
	});
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: `d-${eventId}`,
		rawKind: "pull_request",
		raw: {},
	});
	const runId = generateId();
	await db.insert(runs).values({
		id: runId,
		eventId,
		repoFullName: REPO,
		status: "completed",
		verdict: "block",
		workflowSnapshot: [],
	});

	// Bounded trace shape (post-boundAiReviewTrace).
	await seedStep({
		runId,
		ruleId: "ai-review@2",
		evidence: envelope({
			model: "x-ai/grok-4.5",
			stepsUsed: 2,
			maxSteps: 12,
			trimmed: false,
			usage: { input: 2047, output: 341, cached: 1041 },
			steps: [],
		}),
	});
	// Raw AI SDK trace shape (no stepsUsed; httpRequests falls back to steps.length).
	await seedStep({
		runId,
		ruleId: "ai-review@2",
		evidence: envelope({
			model: "x-ai/grok-4.5",
			steps: [{}, {}],
			usage: {
				inputTokens: 1784,
				outputTokens: 1150,
				inputTokenDetails: { cacheReadTokens: 128 },
			},
		}),
	});
	// Seed trace shape — no usage, must be skipped.
	await seedStep({
		runId,
		ruleId: "ai-review@2",
		evidence: envelope({ findings: 2 }),
	});
	// A non-ai-review step — never scanned.
	await seedStep({ runId, ruleId: "account-age@1", evidence: envelope({}) });

	globalThis.__econRunId = runId;
}, 120_000);

afterAll(async () => {
	await pool?.end();
	await container?.stop();
});

describe("backfillAiReviewUsage", () => {
	test("inserts real traces, skips seed, attributes org", async () => {
		const result = await backfillAiReviewUsage(db);
		expect(result.scanned).toBe(3); // three ai-review@ steps, account-age excluded
		expect(result.inserted).toBe(2); // bounded + raw
		expect(result.skipped).toBe(1); // seed {findings}

		const rows = await db
			.select()
			.from(aiReviewUsage)
			.where(eq(aiReviewUsage.runId, globalThis.__econRunId as string));
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.orgId).toBe(ORG);
			expect(row.source).toBe("prod");
			expect(row.backfilled).toBe(true);
			expect(row.costUsd).toBeNull();
		}
		const bounded = rows.find((r) => r.promptTokens === 2047);
		expect(bounded?.completionTokens).toBe(341);
		expect(bounded?.cachedTokens).toBe(1041);
		expect(bounded?.httpRequests).toBe(2);
		const raw = rows.find((r) => r.promptTokens === 1784);
		expect(raw?.completionTokens).toBe(1150);
		expect(raw?.cachedTokens).toBe(128);
		expect(raw?.httpRequests).toBe(2); // steps.length fallback
	});

	test("is idempotent on run_step_id", async () => {
		const again = await backfillAiReviewUsage(db);
		expect(again.inserted).toBe(0);
		expect(again.skipped).toBe(3);
	});
});

describe("live writers", () => {
	test("recordAiReviewUsage stores exact cost and is idempotent", async () => {
		const runId = globalThis.__econRunId as string;
		// A fresh step with no backfill row, so the live write is the first insert.
		const stepId = await seedStep({
			runId,
			ruleId: "ai-review@2",
			evidence: envelope({}),
		});
		const input = {
			runStepId: stepId,
			runId,
			orgId: ORG,
			model: "x-ai/grok-4.5",
			httpRequests: 2,
			promptTokens: 2047,
			completionTokens: 341,
			cachedTokens: 1041,
			costUsd: 0.003354,
			source: "prod" as const,
		};
		await recordAiReviewUsage(db, input);
		await recordAiReviewUsage(db, input); // conflict → no-op
		const rows = await db
			.select()
			.from(aiReviewUsage)
			.where(eq(aiReviewUsage.runStepId, input.runStepId));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.costUsd).toBe("0.003354");
		expect(rows[0]?.backfilled).toBe(false);
	});

	test("recordUsageCounters is idempotent on run_id", async () => {
		const runId = globalThis.__econRunId as string;
		const input = {
			runId,
			orgId: ORG,
			githubApiCalls: 4,
			githubBytesIn: 5000,
			githubBytesOut: 900,
			openrouterBytesOut: 12000,
			activeMs: 3400,
		};
		await recordUsageCounters(db, input);
		await recordUsageCounters(db, { ...input, githubApiCalls: 99 });
		const { usageCounters } = await import("../schema/economics.ts");
		const rows = await db
			.select()
			.from(usageCounters)
			.where(eq(usageCounters.runId, runId));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.githubApiCalls).toBe(4); // first write wins, no clobber
	});

	test("upsertProviderCost + credit balance read", async () => {
		await upsertProviderCost(db, {
			day: "2026-07-21",
			provider: "openrouter",
			service: "prod-key",
			usageJson: { requests: 3 },
			costUsd: 0.0119,
			estimated: false,
		});
		await upsertProviderCost(db, {
			day: "2026-07-21",
			provider: "openrouter",
			service: "prod-key",
			usageJson: { requests: 5 },
			costUsd: 0.02,
			estimated: false,
		});
		const { providerCostsDaily } = await import("../schema/economics.ts");
		const rows = await db
			.select()
			.from(providerCostsDaily)
			.where(eq(providerCostsDaily.provider, "openrouter"));
		expect(rows).toHaveLength(1); // upsert on (day, provider, service)
		expect(rows[0]?.costUsd).toBe("0.0200");

		expect(await getLastCreditBalance(db)).toBeNull(); // no rollup rows yet
	});
});

describe("recordRunAiReviewUsage (live metering)", () => {
	test("stamps source + captured cost, is idempotent", async () => {
		// A fresh run so no backfill row exists for its steps.
		const eventId = generateId();
		await db.insert(events).values({
			id: eventId,
			deliveryId: `d-${eventId}`,
			rawKind: "pull_request",
			raw: {},
		});
		const runId = generateId();
		await db.insert(runs).values({
			id: runId,
			eventId,
			repoFullName: REPO,
			status: "completed",
			verdict: "block",
			workflowSnapshot: [],
		});
		await seedStep({
			runId,
			ruleId: "ai-review@2",
			evidence: envelope({
				model: "x-ai/grok-4.5",
				stepsUsed: 2,
				maxSteps: 12,
				trimmed: false,
				costUsd: 0.003354,
				usage: { input: 2047, output: 341, cached: 1041 },
				steps: [],
			}),
		});

		const inserted = await recordRunAiReviewUsage(db, {
			runId,
			orgId: ORG,
			source: "prod",
		});
		expect(inserted).toBe(1);

		const rows = await db
			.select()
			.from(aiReviewUsage)
			.where(eq(aiReviewUsage.runId, runId));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.source).toBe("prod");
		expect(rows[0]?.backfilled).toBe(false);
		expect(rows[0]?.costUsd).toBe("0.003354");
		expect(rows[0]?.httpRequests).toBe(2);
		expect(rows[0]?.orgId).toBe(ORG);

		// Re-meter (job retry) is a no-op.
		expect(
			await recordRunAiReviewUsage(db, { runId, orgId: ORG, source: "prod" }),
		).toBe(0);
	});
});

declare global {
	// eslint-disable-next-line no-var
	var __econRunId: string | undefined;
}
