import type { UsageSource } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, like, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	aiReviewUsage,
	economicsDaily,
	providerCostsDaily,
	usageCounters,
} from "../schema/economics.ts";
import { repos } from "../schema/repos.ts";
import { runSteps, runs } from "../schema/runs.ts";

/**
 * Economics persistence (economics-surface-contracts.md). Every writer here is
 * best-effort by contract: the worker wraps each call in try/catch so a metering
 * outage never touches a run. Logic lives in the service, never in the job.
 */

export interface AiReviewUsageInput {
	runStepId: string;
	runId: string;
	orgId: string | null;
	model: string;
	httpRequests: number;
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number | null;
	costUsd: number | null;
	source: UsageSource;
}

/**
 * Insert one ai_review_usage row (one generate() call). Idempotent on
 * run_step_id: a job retry re-inserting the same step is a no-op. `costUsd` is
 * stored as a string to keep the numeric column exact.
 */
export async function recordAiReviewUsage(
	db: Db,
	input: AiReviewUsageInput,
): Promise<void> {
	await db
		.insert(aiReviewUsage)
		.values({
			id: generateId(),
			runStepId: input.runStepId,
			runId: input.runId,
			orgId: input.orgId,
			model: input.model,
			httpRequests: input.httpRequests,
			promptTokens: input.promptTokens,
			completionTokens: input.completionTokens,
			cachedTokens: input.cachedTokens,
			costUsd: input.costUsd === null ? null : input.costUsd.toFixed(6),
			source: input.source,
		})
		.onConflictDoNothing({ target: aiReviewUsage.runStepId });
}

export interface UsageCountersInput {
	runId: string;
	orgId: string | null;
	githubApiCalls: number;
	githubBytesIn: number;
	githubBytesOut: number;
	openrouterBytesOut: number;
	activeMs: number;
}

/** Insert the per-run counter row. Idempotent on run_id (the primary key). */
export async function recordUsageCounters(
	db: Db,
	input: UsageCountersInput,
): Promise<void> {
	await db
		.insert(usageCounters)
		.values({
			runId: input.runId,
			orgId: input.orgId,
			githubApiCalls: input.githubApiCalls,
			githubBytesIn: input.githubBytesIn,
			githubBytesOut: input.githubBytesOut,
			openrouterBytesOut: input.openrouterBytesOut,
			activeMs: input.activeMs,
		})
		.onConflictDoNothing({ target: usageCounters.runId });
}

interface ExtractedUsage {
	model: string;
	httpRequests: number;
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number | null;
}

/**
 * Pull token usage out of a stored run_steps evidence envelope. Handles both
 * historical trace shapes: the bounded {input,output,cached} and the raw AI SDK
 * {inputTokens,outputTokens,inputTokenDetails.cacheReadTokens}. Seed rows
 * ({findings}) and any trace without a usage object return null and are skipped.
 */
function extractTraceUsage(evidence: unknown): ExtractedUsage | null {
	if (!evidence || typeof evidence !== "object") {
		return null;
	}
	const inner = (evidence as { evidence?: unknown }).evidence;
	const trace =
		inner && typeof inner === "object"
			? (inner as { trace?: unknown }).trace
			: null;
	if (!trace || typeof trace !== "object") {
		return null;
	}
	const t = trace as {
		model?: unknown;
		stepsUsed?: unknown;
		steps?: unknown;
		usage?: {
			input?: unknown;
			output?: unknown;
			cached?: unknown;
			inputTokens?: unknown;
			outputTokens?: unknown;
			inputTokenDetails?: { cachedTokens?: unknown; cacheReadTokens?: unknown };
		};
	};
	const usage = t.usage;
	if (!usage || typeof usage !== "object") {
		return null;
	}
	const promptTokens =
		typeof usage.input === "number"
			? usage.input
			: typeof usage.inputTokens === "number"
				? usage.inputTokens
				: null;
	const completionTokens =
		typeof usage.output === "number"
			? usage.output
			: typeof usage.outputTokens === "number"
				? usage.outputTokens
				: null;
	if (promptTokens === null || completionTokens === null) {
		return null;
	}
	const cachedTokens =
		typeof usage.cached === "number"
			? usage.cached
			: typeof usage.inputTokenDetails?.cacheReadTokens === "number"
				? usage.inputTokenDetails.cacheReadTokens
				: typeof usage.inputTokenDetails?.cachedTokens === "number"
					? usage.inputTokenDetails.cachedTokens
					: null;
	const httpRequests =
		typeof t.stepsUsed === "number"
			? t.stepsUsed
			: Array.isArray(t.steps)
				? t.steps.length
				: 1;
	const model = typeof t.model === "string" ? t.model : "unknown";
	return { model, httpRequests, promptTokens, completionTokens, cachedTokens };
}

export interface BackfillUsageResult {
	scanned: number;
	inserted: number;
	skipped: number;
}

/**
 * One-time backfill of ai_review_usage from stored run_steps traces so the admin
 * page is not empty on day one. Rows are marked backfilled with cost_usd null
 * (cost was never stored historically). Source is derived, not guessed: a real
 * trace persisted to run_steps can only have come from the prod worker — eval
 * and dev traffic never write to the database — so backfilled rows are 'prod'.
 * Idempotent: re-running skips steps already recorded (unique on run_step_id).
 */
export async function backfillAiReviewUsage(
	db: Db,
): Promise<BackfillUsageResult> {
	const rows = await db
		.select({
			runStepId: runSteps.id,
			runId: runSteps.runId,
			evidence: runSteps.evidence,
			orgId: repos.orgId,
		})
		.from(runSteps)
		.innerJoin(runs, eq(runSteps.runId, runs.id))
		.leftJoin(repos, eq(repos.fullName, runs.repoFullName))
		.where(like(runSteps.ruleId, "ai-review@%"));

	const result: BackfillUsageResult = {
		scanned: rows.length,
		inserted: 0,
		skipped: 0,
	};
	for (const row of rows) {
		const usage = extractTraceUsage(row.evidence);
		if (!usage) {
			result.skipped++;
			continue;
		}
		const before = await db
			.insert(aiReviewUsage)
			.values({
				id: generateId(),
				runStepId: row.runStepId,
				runId: row.runId,
				orgId: row.orgId ?? null,
				model: usage.model,
				httpRequests: usage.httpRequests,
				promptTokens: usage.promptTokens,
				completionTokens: usage.completionTokens,
				cachedTokens: usage.cachedTokens,
				costUsd: null,
				source: "prod",
				backfilled: true,
			})
			.onConflictDoNothing({ target: aiReviewUsage.runStepId })
			.returning({ id: aiReviewUsage.id });
		if (before.length > 0) {
			result.inserted++;
		} else {
			result.skipped++;
		}
	}
	return result;
}

/** Upsert one pulled provider cost row (pull-provider-costs cron). */
export async function upsertProviderCost(
	db: Db,
	input: {
		day: string;
		provider: string;
		service: string;
		usageJson: unknown;
		costUsd: number;
		estimated: boolean;
	},
): Promise<void> {
	await db
		.insert(providerCostsDaily)
		.values({
			day: input.day,
			provider: input.provider,
			service: input.service,
			usageJson: input.usageJson,
			costUsd: input.costUsd.toFixed(4),
			estimated: input.estimated,
		})
		.onConflictDoUpdate({
			target: [
				providerCostsDaily.day,
				providerCostsDaily.provider,
				providerCostsDaily.service,
			],
			set: {
				usageJson: input.usageJson,
				costUsd: input.costUsd.toFixed(4),
				estimated: input.estimated,
				pulledAt: sql`now()`,
			},
		});
}

/** The last recorded credit balance, for the running decrement. Null if none. */
export async function getLastCreditBalance(db: Db): Promise<number | null> {
	const [row] = await db
		.select({ balance: economicsDaily.creditBalanceUsd })
		.from(economicsDaily)
		.where(
			and(
				sql`${economicsDaily.orgId} is null`,
				sql`${economicsDaily.creditBalanceUsd} is not null`,
			),
		)
		.orderBy(sql`${economicsDaily.day} desc`)
		.limit(1);
	return row?.balance == null ? null : Number(row.balance);
}
