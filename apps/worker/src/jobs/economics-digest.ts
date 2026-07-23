import {
	creditRunwayMonths,
	DRIFT_ALERT_PCT,
	OR_CREDIT_FEE_MULTIPLIER,
	OR_DAILY_CAP_USD,
	PLANETSCALE_MONTHLY,
	RAILWAY_FLOOR,
	RAILWAY_FLOOR_WARN_USD,
} from "@tripwire/contracts";
import type { DailyTotals, Db, MonthlySummary } from "@tripwire/db";
import { economicsServices } from "@tripwire/db";
import { guardedPost } from "@tripwire/utils";
import type { Logger } from "pino";
import { previousUtcDay } from "./pull-provider-costs.ts";

/**
 * economics-digest (economics-surface-contracts.md): read the prior day's totals
 * row and post a three-line Discord digest, with any threshold breaches as
 * [ALERT] lines. On the 1st of the month it also posts the monthly report for
 * the month that just closed. Cron 02:30 UTC, after the rollup. All output is
 * best-effort: a missing webhook or a post failure is logged, never thrown.
 *
 * Copy rules: no em dashes, short declarative lines, sentence case.
 */

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function shortDate(day: string): string {
	const [, m, d] = day.split("-").map(Number);
	return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

function monthName(month: string): string {
	const [y, m] = month.split("-").map(Number);
	return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

const money = (n: number, dp = 4) => `$${n.toFixed(dp)}`;

export interface AlertThresholds {
	orDailyCapUsd: number;
	driftAlertPct: number;
	railwayFloorWarnUsd: number;
}

export function thresholdsFromEnv(): AlertThresholds {
	const numEnv = (key: string, fallback: number) => {
		const raw = process.env[key];
		const n = raw == null ? Number.NaN : Number(raw);
		return Number.isFinite(n) ? n : fallback;
	};
	return {
		orDailyCapUsd: numEnv("OR_DAILY_CAP_USD", OR_DAILY_CAP_USD),
		driftAlertPct: numEnv("DRIFT_ALERT_PCT", DRIFT_ALERT_PCT),
		railwayFloorWarnUsd: numEnv(
			"RAILWAY_FLOOR_WARN_USD",
			RAILWAY_FLOOR_WARN_USD,
		),
	};
}

/** The OpenRouter spend to gauge against the cap: the pulled figure, else metered. */
function orSpend(t: DailyTotals): number {
	return t.pulledCostUsd ?? t.meteredCostUsd;
}

/** The three-line digest body. Pure so it is unit-tested against fixtures. */
export function formatDigest(t: DailyTotals): string {
	const drift = t.driftPct == null ? "n/a" : `${t.driftPct.toFixed(1)}% OK`;
	const credits =
		t.creditBalanceUsd == null
			? "credits n/a"
			: `credits ${money(t.creditBalanceUsd, 2)} (${creditRunwayMonths(
					t.creditBalanceUsd,
				).toFixed(1)}mo)`;
	const railway =
		t.railwayUsageUsd == null
			? "Railway n/a"
			: `Railway ${money(t.railwayUsageUsd, 2)}/${money(RAILWAY_FLOOR, 2)}`;
	return [
		`Tripwire economics · ${shortDate(t.day)}`,
		`runs ${t.runs} (${t.aiReviewedRuns} AI) · metered ${money(
			t.meteredCostUsd,
		)} · drift ${drift}`,
		`${credits} · ${railway} · OR today ${money(orSpend(t))}`,
	].join("\n");
}

/** Threshold breaches as [ALERT] lines. Empty when nothing is breached. */
export function buildAlerts(t: DailyTotals, th: AlertThresholds): string[] {
	const alerts: string[] = [];
	const or = orSpend(t);
	if (or > th.orDailyCapUsd) {
		alerts.push(
			`[ALERT] OR daily spend ${money(or)} exceeds ${money(
				th.orDailyCapUsd,
				2,
			)} cap · source=prod · check /admin/economics`,
		);
	}
	if (t.driftPct != null && Math.abs(t.driftPct) > th.driftAlertPct) {
		alerts.push(
			`[ALERT] drift ${t.driftPct.toFixed(1)}% exceeds ${th.driftAlertPct}% · metered ${money(
				t.meteredCostUsd,
			)} vs pulled ${money(t.pulledCostUsd ?? 0)} (${shortDate(t.day)})`,
		);
	}
	if (
		t.railwayUsageUsd != null &&
		t.railwayUsageUsd >= th.railwayFloorWarnUsd
	) {
		alerts.push(
			`[ALERT] Railway usage ${money(t.railwayUsageUsd, 2)} approaching ${money(
				RAILWAY_FLOOR,
				2,
			)} floor`,
		);
	}
	return alerts;
}

/** The long-form monthly report. Pure. Cash view applies the OR credit fee. */
export function formatMonthlyReport(s: MonthlySummary): string {
	const railway = Math.max(RAILWAY_FLOOR, s.railwayUsageUsd ?? 0);
	const accrued = railway + PLANETSCALE_MONTHLY + s.meteredCostUsd;
	const cashAi = s.meteredCostUsd * OR_CREDIT_FEE_MULTIPLIER;
	const cash = railway + cashAi; // PlanetScale covered by credits => $0 cash
	const costPerRun = s.runs > 0 ? s.meteredCostUsd / s.runs : 0;
	const drift = s.driftAvgPct == null ? "n/a" : `${s.driftAvgPct.toFixed(1)}%`;
	const balance =
		s.creditBalanceUsd == null ? "n/a" : money(s.creditBalanceUsd, 2);
	const runway =
		s.creditBalanceUsd == null
			? "n/a"
			: `${creditRunwayMonths(s.creditBalanceUsd).toFixed(1)}mo`;
	return [
		`# Economics: ${monthName(s.month)}`,
		"",
		`Accrued: ${money(accrued, 2)} (Railway ${money(railway, 2)}, PlanetScale ${money(
			PLANETSCALE_MONTHLY,
			2,
		)}, AI ${money(s.meteredCostUsd, 2)})`,
		`Cash: ${money(cash, 2)} (AI x ${OR_CREDIT_FEE_MULTIPLIER} fee, credits cover PlanetScale, balance ${balance}, runway ${runway})`,
		"",
		`Runs ${s.runs} · AI-reviewed ${s.aiReviewedRuns} · cost/run ${money(
			costPerRun,
		)} (ceiling ${money(0.01)}) · drift avg ${drift}`,
		"",
		"Flags:",
		`- unattributed rows: ${s.unattributedRuns} runs (${money(
			s.unattributedCostUsd,
		)}), from unclaimed installs`,
		`- eval-key spend ${money(s.evalSpendUsd, 2)} excluded from COGS`,
		"",
		"Manual reconcile: compare provider invoices vs provider_costs_daily sums.",
	].join("\n");
}

type PostFn = (url: string, body: unknown) => Promise<{ ok: boolean }>;

export interface DigestDeps {
	db: Db;
	logger: Logger;
	webhookUrl?: string | null;
	thresholds?: AlertThresholds;
	now?: Date;
	postImpl?: PostFn;
}

function resolveWebhook(deps: DigestDeps): string | null {
	return (
		deps.webhookUrl ??
		process.env.ECONOMICS_WEBHOOK_URL ??
		process.env.FEEDBACK_WEBHOOK_URL ??
		null
	);
}

async function post(deps: DigestDeps, url: string, content: string) {
	const fn: PostFn = deps.postImpl ?? ((u, body) => guardedPost(u, body));
	const result = await fn(url, { content });
	if (!result.ok) {
		deps.logger.warn("economics digest post failed");
	}
}

/**
 * Post the long-form monthly report for `month` (YYYY-MM) to the economics
 * channel. Used by the digest cron on the 1st and by the manual trigger's
 * `report` command. Returns false when no webhook is configured.
 */
export async function postMonthlyReport(
	deps: DigestDeps,
	month: string,
): Promise<boolean> {
	const webhookUrl = resolveWebhook(deps);
	if (!webhookUrl) {
		deps.logger.info("no economics webhook configured — report skipped");
		return false;
	}
	const summary = await economicsServices.getMonthlySummary(deps.db, month);
	await post(deps, webhookUrl, formatMonthlyReport(summary));
	deps.logger.info({ month }, "monthly economics report posted");
	return true;
}

export async function economicsDigest(deps: DigestDeps): Promise<void> {
	const now = deps.now ?? new Date();
	const webhookUrl = resolveWebhook(deps);
	if (!webhookUrl) {
		deps.logger.info("no economics webhook configured — digest skipped");
		return;
	}
	const day = previousUtcDay(now);
	const totals = await economicsServices.getDailyTotals(deps.db, day);
	if (!totals) {
		deps.logger.warn({ day }, "no economics rollup for day — digest skipped");
		return;
	}
	const thresholds = deps.thresholds ?? thresholdsFromEnv();

	const lines = [formatDigest(totals), ...buildAlerts(totals, thresholds)];
	await post(deps, webhookUrl, lines.join("\n"));

	// On the 1st, the day that just closed is the last of the previous month.
	if (now.getUTCDate() === 1) {
		await postMonthlyReport(deps, day.slice(0, 7));
	}
	deps.logger.info(
		{ day, alerts: lines.length - 1 },
		"economics digest posted",
	);
}
