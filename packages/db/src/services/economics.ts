import type { UsageSource } from "@tripwire/contracts";
import {
	creditRunwayMonths,
	PLANETSCALE_CREDITS_START,
	PLANETSCALE_MONTHLY,
	RAILWAY_FLOOR,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import type { AnyColumn } from "drizzle-orm";
import { and, desc, eq, gte, like, ne, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	aiReviewUsage,
	economicsDaily,
	providerCostsDaily,
	usageCounters,
} from "../schema/economics.ts";
import { organization } from "../schema/organizations.ts";
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
	costUsd: number | null;
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
		costUsd?: unknown;
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
	const costUsd =
		typeof t.costUsd === "number" && Number.isFinite(t.costUsd)
			? t.costUsd
			: null;
	return {
		model,
		httpRequests,
		promptTokens,
		completionTokens,
		cachedTokens,
		costUsd,
	};
}

/**
 * Meter every ai-review step of a just-persisted run into ai_review_usage. Live
 * companion to the backfill: reads the same evidence traces, but stamps the
 * derived `source` and the captured cost, and marks the rows not-backfilled.
 * Idempotent on run_step_id, so a job retry re-metering the run is a no-op.
 * Best-effort by contract — the worker calls this inside try/catch.
 */
export async function recordRunAiReviewUsage(
	db: Db,
	input: { runId: string; orgId: string | null; source: UsageSource },
): Promise<number> {
	const steps = await db
		.select({ id: runSteps.id, evidence: runSteps.evidence })
		.from(runSteps)
		.where(
			and(
				eq(runSteps.runId, input.runId),
				like(runSteps.ruleId, "ai-review@%"),
			),
		);
	let inserted = 0;
	for (const step of steps) {
		const usage = extractTraceUsage(step.evidence);
		if (!usage) {
			continue;
		}
		const rows = await db
			.insert(aiReviewUsage)
			.values({
				id: generateId(),
				runStepId: step.id,
				runId: input.runId,
				orgId: input.orgId,
				model: usage.model,
				httpRequests: usage.httpRequests,
				promptTokens: usage.promptTokens,
				completionTokens: usage.completionTokens,
				cachedTokens: usage.cachedTokens,
				costUsd: usage.costUsd === null ? null : usage.costUsd.toFixed(6),
				source: input.source,
			})
			.onConflictDoNothing({ target: aiReviewUsage.runStepId })
			.returning({ id: aiReviewUsage.id });
		if (rows.length > 0) {
			inserted++;
		}
	}
	return inserted;
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

export interface DailyTotals {
	day: string;
	runs: number;
	aiReviewedRuns: number;
	meteredCostUsd: number;
	unattributedRuns: number;
	unattributedCostUsd: number;
	pulledCostUsd: number | null;
	driftPct: number | null;
	creditBalanceUsd: number | null;
	railwayUsageUsd: number | null;
}

/** The null-org totals + reconciliation row for a day, or null if not rolled. */
export async function getDailyTotals(
	db: Db,
	day: string,
): Promise<DailyTotals | null> {
	const [row] = await db
		.select()
		.from(economicsDaily)
		.where(
			and(eq(economicsDaily.day, day), sql`${economicsDaily.orgId} is null`),
		)
		.limit(1);
	if (!row) {
		return null;
	}
	return {
		day,
		runs: row.runs,
		aiReviewedRuns: row.aiReviewedRuns,
		meteredCostUsd: num(row.meteredCostUsd),
		unattributedRuns: num(row.unattributedRuns),
		unattributedCostUsd: num(row.unattributedCostUsd),
		pulledCostUsd: row.pulledCostUsd == null ? null : num(row.pulledCostUsd),
		driftPct: row.driftPct == null ? null : num(row.driftPct),
		creditBalanceUsd:
			row.creditBalanceUsd == null ? null : num(row.creditBalanceUsd),
		railwayUsageUsd:
			row.railwayUsageUsd == null ? null : num(row.railwayUsageUsd),
	};
}

export interface MonthlySummary {
	month: string;
	runs: number;
	aiReviewedRuns: number;
	meteredCostUsd: number;
	driftAvgPct: number | null;
	creditBalanceUsd: number | null;
	railwayUsageUsd: number | null;
	unattributedRuns: number;
	unattributedCostUsd: number;
	evalSpendUsd: number;
}

function monthBounds(month: string): { start: string; next: string } {
	const [y, m] = month.split("-").map(Number);
	const start = `${month}-01`;
	const nextMonth = m === 12 ? 1 : (m ?? 1) + 1;
	const nextYear = m === 12 ? (y ?? 0) + 1 : y;
	const next = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
	return { start, next };
}

/**
 * Aggregate a calendar month (YYYY-MM) from the daily totals rows plus the eval
 * spend from the invoice table, for the monthly report. Metered cost is prod
 * COGS; eval spend is reported separately and never folded in.
 */
export async function getMonthlySummary(
	db: Db,
	month: string,
): Promise<MonthlySummary> {
	const { start, next } = monthBounds(month);
	const inMonth = (col: AnyColumn) =>
		and(sql`${col} >= ${start}`, sql`${col} < ${next}`);

	const [totals] = await db
		.select({
			runs: sql<number>`coalesce(sum(${economicsDaily.runs}),0)::int`,
			aiRuns: sql<number>`coalesce(sum(${economicsDaily.aiReviewedRuns}),0)::int`,
			metered: sql<string>`coalesce(sum(${economicsDaily.meteredCostUsd}),0)`,
			driftAvg: sql<string | null>`avg(${economicsDaily.driftPct})`,
			unRuns: sql<number>`coalesce(sum(${economicsDaily.unattributedRuns}),0)::int`,
			unCost: sql<string>`coalesce(sum(${economicsDaily.unattributedCostUsd}),0)`,
		})
		.from(economicsDaily)
		.where(
			and(sql`${economicsDaily.orgId} is null`, inMonth(economicsDaily.day)),
		);

	const [latest] = await db
		.select({
			credit: economicsDaily.creditBalanceUsd,
			railway: economicsDaily.railwayUsageUsd,
		})
		.from(economicsDaily)
		.where(
			and(sql`${economicsDaily.orgId} is null`, inMonth(economicsDaily.day)),
		)
		.orderBy(desc(economicsDaily.day))
		.limit(1);

	const [evalRow] = await db
		.select({
			cost: sql<string>`coalesce(sum(${providerCostsDaily.costUsd}),0)`,
		})
		.from(providerCostsDaily)
		.where(
			and(
				eq(providerCostsDaily.provider, "openrouter"),
				eq(providerCostsDaily.service, "eval-key"),
				inMonth(providerCostsDaily.day),
			),
		);

	return {
		month,
		runs: num(totals?.runs),
		aiReviewedRuns: num(totals?.aiRuns),
		meteredCostUsd: num(totals?.metered),
		driftAvgPct: totals?.driftAvg == null ? null : num(totals.driftAvg),
		creditBalanceUsd: latest?.credit == null ? null : num(latest.credit),
		railwayUsageUsd: latest?.railway == null ? null : num(latest.railway),
		unattributedRuns: num(totals?.unRuns),
		unattributedCostUsd: num(totals?.unCost),
		evalSpendUsd: num(evalRow?.cost),
	};
}

export interface EconomicsOverview {
	month: string;
	runs: number;
	aiReviewedRuns: number;
	meteredMtdUsd: number;
	accruedMtdUsd: number;
	costPerRunUsd: number;
	costCeilingUsd: number;
	driftPct: number | null;
	creditBalanceUsd: number | null;
	creditRunwayMonths: number | null;
	railwayUsageUsd: number | null;
	railwayFloorUsd: number;
}

/** The four-card summary for the admin page: cost per run, metered vs accrued,
 * drift, runs, plus the credit and floor gauges. Derived from the month's rows. */
export async function getEconomicsOverview(
	db: Db,
	month: string,
): Promise<EconomicsOverview> {
	const s = await getMonthlySummary(db, month);
	const railway = Math.max(RAILWAY_FLOOR, s.railwayUsageUsd ?? 0);
	const accrued = railway + PLANETSCALE_MONTHLY + s.meteredCostUsd;
	return {
		month,
		runs: s.runs,
		aiReviewedRuns: s.aiReviewedRuns,
		meteredMtdUsd: s.meteredCostUsd,
		accruedMtdUsd: accrued,
		costPerRunUsd: s.runs > 0 ? s.meteredCostUsd / s.runs : 0,
		costCeilingUsd: 0.01,
		driftPct: s.driftAvgPct,
		creditBalanceUsd: s.creditBalanceUsd,
		creditRunwayMonths:
			s.creditBalanceUsd == null ? null : creditRunwayMonths(s.creditBalanceUsd),
		railwayUsageUsd: s.railwayUsageUsd,
		railwayFloorUsd: RAILWAY_FLOOR,
	};
}

export interface EconomicsDayPoint {
	day: string;
	runs: number;
	meteredCostUsd: number;
	pulledCostUsd: number | null;
	creditBalanceUsd: number | null;
	railwayUsageUsd: number | null;
}

/** The trailing daily totals series for the charts (burn-down, OR spend, floor). */
export async function getEconomicsSeries(
	db: Db,
	days: number,
	now?: Date,
): Promise<EconomicsDayPoint[]> {
	const to = now ?? new Date();
	const from = new Date(to.getTime());
	from.setUTCDate(from.getUTCDate() - days);
	const fromDay = from.toISOString().slice(0, 10);
	const rows = await db
		.select({
			day: economicsDaily.day,
			runs: economicsDaily.runs,
			metered: economicsDaily.meteredCostUsd,
			pulled: economicsDaily.pulledCostUsd,
			credit: economicsDaily.creditBalanceUsd,
			railway: economicsDaily.railwayUsageUsd,
		})
		.from(economicsDaily)
		.where(
			and(
				sql`${economicsDaily.orgId} is null`,
				gte(economicsDaily.day, fromDay),
			),
		)
		.orderBy(economicsDaily.day);
	return rows.map((r) => ({
		day: r.day,
		runs: r.runs,
		meteredCostUsd: num(r.metered),
		pulledCostUsd: r.pulled == null ? null : num(r.pulled),
		creditBalanceUsd: r.credit == null ? null : num(r.credit),
		railwayUsageUsd: r.railway == null ? null : num(r.railway),
	}));
}

export interface CostByOrgRow {
	orgId: string | null;
	orgName: string | null;
	orgSlug: string | null;
	runs: number;
	aiReviewedRuns: number;
	meteredCostUsd: number;
}

/** Cost by org for the month, plus an explicit unattributed row. Sorted by cost,
 * unattributed last, so an org's share and the unclaimed bucket are both visible. */
export async function getCostByOrg(
	db: Db,
	month: string,
): Promise<CostByOrgRow[]> {
	const { start, next } = monthBounds(month);
	const inMonth = and(
		sql`${economicsDaily.day} >= ${start}`,
		sql`${economicsDaily.day} < ${next}`,
	);
	const orgRows = await db
		.select({
			orgId: economicsDaily.orgId,
			orgName: organization.name,
			orgSlug: organization.slug,
			runs: sql<number>`coalesce(sum(${economicsDaily.runs}),0)::int`,
			aiRuns: sql<number>`coalesce(sum(${economicsDaily.aiReviewedRuns}),0)::int`,
			metered: sql<string>`coalesce(sum(${economicsDaily.meteredCostUsd}),0)`,
		})
		.from(economicsDaily)
		.leftJoin(organization, eq(organization.id, economicsDaily.orgId))
		.where(and(sql`${economicsDaily.orgId} is not null`, inMonth))
		.groupBy(economicsDaily.orgId, organization.name, organization.slug)
		.orderBy(desc(sql`sum(${economicsDaily.meteredCostUsd})`));

	const [unattr] = await db
		.select({
			runs: sql<number>`coalesce(sum(${economicsDaily.unattributedRuns}),0)::int`,
			metered: sql<string>`coalesce(sum(${economicsDaily.unattributedCostUsd}),0)`,
		})
		.from(economicsDaily)
		.where(and(sql`${economicsDaily.orgId} is null`, inMonth));

	const rows: CostByOrgRow[] = orgRows.map((r) => ({
		orgId: r.orgId,
		orgName: r.orgName,
		orgSlug: r.orgSlug,
		runs: num(r.runs),
		aiReviewedRuns: num(r.aiRuns),
		meteredCostUsd: num(r.metered),
	}));
	// The unattributed bucket is always surfaced, even at zero (reading rule 4).
	rows.push({
		orgId: null,
		orgName: null,
		orgSlug: null,
		runs: num(unattr?.runs),
		aiReviewedRuns: 0,
		meteredCostUsd: num(unattr?.metered),
	});
	return rows;
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

/**
 * The last recorded credit balance strictly before `beforeDay`, for the running
 * decrement. Reading only earlier days makes the rollup idempotent: re-running a
 * day recomputes the same balance instead of decrementing twice. Null if none.
 */
export async function getLastCreditBalance(
	db: Db,
	beforeDay?: string,
): Promise<number | null> {
	const [row] = await db
		.select({ balance: economicsDaily.creditBalanceUsd })
		.from(economicsDaily)
		.where(
			and(
				sql`${economicsDaily.orgId} is null`,
				sql`${economicsDaily.creditBalanceUsd} is not null`,
				beforeDay ? sql`${economicsDaily.day} < ${beforeDay}` : undefined,
			),
		)
		.orderBy(desc(economicsDaily.day))
		.limit(1);
	return row?.balance == null ? null : Number(row.balance);
}

function daysInUtcMonth(day: string): number {
	const [y, m] = day.split("-").map(Number);
	if (!y || !m) {
		return 30;
	}
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
/** Map key for the org grain: null org uses the totals sentinel. */
const orgKey = (orgId: string | null): string => orgId ?? "~platform";

export interface RollupResult {
	day: string;
	orgRows: number;
	meteredCostUsd: number;
	pulledCostUsd: number;
	driftPct: number | null;
	creditBalanceUsd: number;
}

/**
 * Roll one UTC day into economics_daily (economics-surface-contracts.md): one
 * row per org active that day, plus a null-org totals row carrying platform
 * totals, the unattributed bucket, and reconciliation (pulled cost, drift,
 * credit balance, Railway usage). COGS sums always filter source = 'prod'.
 * Idempotent: it deletes the day's rows and rewrites them in one transaction, so
 * a re-run is exact, not additive.
 */
export async function rollupEconomicsDay(
	db: Db,
	day: string,
	opts?: { creditsStart?: number; planetscaleMonthly?: number },
): Promise<RollupResult> {
	const creditsStart = opts?.creditsStart ?? PLANETSCALE_CREDITS_START;
	const monthly = opts?.planetscaleMonthly ?? PLANETSCALE_MONTHLY;
	const onDay = (col: string) => sql.raw(`${col}::date = '${day}'`);

	// A. runs per org (attributed via repo.org_id; null = unattributed).
	const runRows = await db
		.select({
			orgId: repos.orgId,
			runs: sql<number>`count(*)::int`,
		})
		.from(runs)
		.leftJoin(repos, eq(repos.fullName, runs.repoFullName))
		.where(onDay("runs.created_at"))
		.groupBy(repos.orgId);

	// B. prod ai-review metrics per org.
	const aiRows = await db
		.select({
			orgId: aiReviewUsage.orgId,
			aiRuns: sql<number>`count(distinct ${aiReviewUsage.runId})::int`,
			promptTokens: sql<number>`coalesce(sum(${aiReviewUsage.promptTokens}),0)::int`,
			completionTokens: sql<number>`coalesce(sum(${aiReviewUsage.completionTokens}),0)::int`,
			cost: sql<string>`coalesce(sum(${aiReviewUsage.costUsd}),0)`,
		})
		.from(aiReviewUsage)
		.where(
			and(
				eq(aiReviewUsage.source, "prod"),
				onDay("ai_review_usage.created_at"),
			),
		)
		.groupBy(aiReviewUsage.orgId);

	// Merge the two grains per org.
	interface OrgAgg {
		orgId: string | null;
		runs: number;
		aiRuns: number;
		promptTokens: number;
		completionTokens: number;
		cost: number;
	}
	const byOrg = new Map<string, OrgAgg>();
	const get = (orgId: string | null): OrgAgg => {
		const key = orgKey(orgId);
		let agg = byOrg.get(key);
		if (!agg) {
			agg = {
				orgId,
				runs: 0,
				aiRuns: 0,
				promptTokens: 0,
				completionTokens: 0,
				cost: 0,
			};
			byOrg.set(key, agg);
		}
		return agg;
	};
	for (const r of runRows) {
		get(r.orgId).runs += num(r.runs);
	}
	for (const a of aiRows) {
		const agg = get(a.orgId);
		agg.aiRuns += num(a.aiRuns);
		agg.promptTokens += num(a.promptTokens);
		agg.completionTokens += num(a.completionTokens);
		agg.cost += num(a.cost);
	}

	// C. pulled OpenRouter cost for the day, prod scope (eval-key excluded).
	const [pulled] = await db
		.select({
			cost: sql<string>`coalesce(sum(${providerCostsDaily.costUsd}),0)`,
		})
		.from(providerCostsDaily)
		.where(
			and(
				eq(providerCostsDaily.day, day),
				eq(providerCostsDaily.provider, "openrouter"),
				ne(providerCostsDaily.service, "eval-key"),
			),
		);
	const pulledCostUsd = num(pulled?.cost);

	// D. latest Railway usage figure for the day (the floor gauge).
	const [railway] = await db
		.select({ cost: providerCostsDaily.costUsd })
		.from(providerCostsDaily)
		.where(
			and(
				eq(providerCostsDaily.day, day),
				eq(providerCostsDaily.provider, "railway"),
			),
		)
		.orderBy(desc(providerCostsDaily.pulledAt))
		.limit(1);
	const railwayUsageUsd = railway ? num(railway.cost) : null;

	// Totals + unattributed.
	let totalRuns = 0;
	let totalAiRuns = 0;
	let totalPrompt = 0;
	let totalCompletion = 0;
	let totalCost = 0;
	let unattributedRuns = 0;
	let unattributedCost = 0;
	for (const agg of byOrg.values()) {
		totalRuns += agg.runs;
		totalAiRuns += agg.aiRuns;
		totalPrompt += agg.promptTokens;
		totalCompletion += agg.completionTokens;
		totalCost += agg.cost;
		if (agg.orgId === null) {
			unattributedRuns += agg.runs;
			unattributedCost += agg.cost;
		}
	}

	// Drift excludes the OpenRouter credit-fee multiplier by design.
	const driftPct =
		pulledCostUsd > 0
			? ((pulledCostUsd - totalCost) / pulledCostUsd) * 100
			: null;

	// Credit decrement from the prior day only (idempotent on re-run).
	const prev = await getLastCreditBalance(db, day);
	const creditBalanceUsd =
		(prev ?? creditsStart) - monthly / daysInUtcMonth(day);

	const money6 = (n: number) => n.toFixed(6);
	const money2 = (n: number) => n.toFixed(2);

	await db.transaction(async (tx) => {
		await tx.delete(economicsDaily).where(eq(economicsDaily.day, day));
		// Per-org rows (skip the null-org agg; it folds into the totals row).
		for (const agg of byOrg.values()) {
			if (agg.orgId === null) {
				continue;
			}
			await tx.insert(economicsDaily).values({
				day,
				orgId: agg.orgId,
				runs: agg.runs,
				aiReviewedRuns: agg.aiRuns,
				promptTokens: agg.promptTokens,
				completionTokens: agg.completionTokens,
				meteredCostUsd: money6(agg.cost),
			});
		}
		// The null-org totals + reconciliation row.
		await tx.insert(economicsDaily).values({
			day,
			orgId: null,
			runs: totalRuns,
			aiReviewedRuns: totalAiRuns,
			promptTokens: totalPrompt,
			completionTokens: totalCompletion,
			meteredCostUsd: money6(totalCost),
			unattributedRuns,
			unattributedCostUsd: money6(unattributedCost),
			pulledCostUsd: money6(pulledCostUsd),
			driftPct: driftPct === null ? null : driftPct.toFixed(2),
			creditBalanceUsd: money2(creditBalanceUsd),
			railwayUsageUsd:
				railwayUsageUsd === null ? null : money2(railwayUsageUsd),
		});
	});

	return {
		day,
		orgRows: [...byOrg.values()].filter((a) => a.orgId !== null).length,
		meteredCostUsd: totalCost,
		pulledCostUsd,
		driftPct,
		creditBalanceUsd,
	};
}
