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
 * row and post a short Discord digest written in plain sentences, with any
 * threshold breaches as [ALERT] lines. On the 1st of the month it also posts the
 * monthly report for the month that just closed. Cron 02:30 UTC, after the
 * rollup. All output is best-effort: a missing webhook or a post failure is
 * logged, never thrown.
 *
 * Copy rules: no em dashes, short declarative lines, sentence case. State the
 * numbers plainly and say what they mean; let [ALERT] lines carry the judgment.
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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

/**
 * The daily digest body, in plain sentences. Pure so it is unit-tested against
 * fixtures. The drift line states the gap without judging it: buildAlerts owns
 * "is this a problem", so the digest never claims a breaching day is "OK".
 */
export function formatDigest(t: DailyTotals): string {
	const orLine =
		t.pulledCostUsd == null || t.driftPct == null
			? "OpenRouter's cost for the day isn't in yet."
			: `OpenRouter charged ${money(t.pulledCostUsd)}, so billing ran ${Math.abs(
					t.driftPct,
				).toFixed(1)}% ${t.driftPct >= 0 ? "under" : "over"}.`;
	const creditLine =
		t.creditBalanceUsd == null
			? "Credit balance isn't in yet."
			: `Credits ${money(t.creditBalanceUsd, 2)}, about ${creditRunwayMonths(
					t.creditBalanceUsd,
				).toFixed(1)} months of runway.`;
	const railwayLine =
		t.railwayUsageUsd == null
			? "Railway usage isn't in yet."
			: `Railway ${money(t.railwayUsageUsd, 2)} of ${money(RAILWAY_FLOOR, 2)}.`;
	return [
		`Tripwire economics for ${shortDate(t.day)}.`,
		`${plural(t.runs, "change request")} ran, ${t.aiReviewedRuns} through the AI reviewer.`,
		`We billed ${money(t.meteredCostUsd)}. ${orLine}`,
		`${creditLine} ${railwayLine}`,
	].join("\n");
}

/** Threshold breaches as [ALERT] lines. Empty when nothing is breached. */
export function buildAlerts(t: DailyTotals, th: AlertThresholds): string[] {
	const alerts: string[] = [];
	const or = orSpend(t);
	if (or > th.orDailyCapUsd) {
		alerts.push(
			`[ALERT] OpenRouter spend hit ${money(or)} today, over the ${money(
				th.orDailyCapUsd,
				2,
			)} cap. Check /admin/economics.`,
		);
	}
	if (t.driftPct != null && Math.abs(t.driftPct) > th.driftAlertPct) {
		alerts.push(
			`[ALERT] Billing drifted ${t.driftPct.toFixed(1)}% from actual on ${shortDate(
				t.day,
			)}, over the ${th.driftAlertPct}% limit. Billed ${money(
				t.meteredCostUsd,
			)} against OpenRouter's ${money(t.pulledCostUsd ?? 0)}. Check the meter or model prices.`,
		);
	}
	if (
		t.railwayUsageUsd != null &&
		t.railwayUsageUsd >= th.railwayFloorWarnUsd
	) {
		alerts.push(
			`[ALERT] Railway usage is ${money(t.railwayUsageUsd, 2)}, close to the ${money(
				RAILWAY_FLOOR,
				2,
			)} floor.`,
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
			: `${creditRunwayMonths(s.creditBalanceUsd).toFixed(1)} months`;
	const driftLine =
		s.driftAvgPct == null
			? "Drift from actual wasn't available this month."
			: `Billing tracked actual within ${drift} on average.`;
	return [
		`# Economics for ${monthName(s.month)}`,
		"",
		`We ran ${plural(s.runs, "change request")}, ${s.aiReviewedRuns} through the AI reviewer. That is ${money(
			costPerRun,
		)} per run, under the ${money(0.01)} ceiling. ${driftLine}`,
		"",
		`Accrued cost was ${money(accrued, 2)}: Railway ${money(railway, 2)}, PlanetScale ${money(
			PLANETSCALE_MONTHLY,
			2,
		)}, AI ${money(s.meteredCostUsd, 2)}.`,
		`Cash out was ${money(cash, 2)}: AI at the ${OR_CREDIT_FEE_MULTIPLIER} OpenRouter fee, with credits covering PlanetScale. Credit balance ${balance}, about ${runway} of runway.`,
		"",
		"Worth noting:",
		`- ${plural(s.unattributedRuns, "run")} (${money(
			s.unattributedCostUsd,
		)}) had no install attributed, likely from unclaimed installs.`,
		`- ${money(s.evalSpendUsd, 2)} of eval-key spend is excluded from COGS.`,
		"",
		"To reconcile by hand, compare the provider invoices against the provider_costs_daily sums.",
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
