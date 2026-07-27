import {
	creditRunwayMonths,
	DRIFT_ALERT_PCT,
	OR_CREDIT_FEE_MULTIPLIER,
	OR_DAILY_CAP_USD,
	PLANETSCALE_MONTHLY,
	RAILWAY_FLOOR,
	RAILWAY_FLOOR_WARN_USD,
	REVIEW_MODEL,
} from "@tripwire/contracts";
import type {
	DailyCostPoint,
	DailyTotals,
	Db,
	MonthlySummary,
} from "@tripwire/db";
import { economicsServices } from "@tripwire/db";
import {
	guardedPost,
	guardedPostMultipart,
	type MultipartFile,
	renderSparklinePng,
} from "@tripwire/utils";
import type { Logger } from "pino";
import { previousUtcDay } from "./pull-provider-costs.ts";

/**
 * economics-digest (economics-surface-contracts.md): read the prior day's totals
 * row and post a Discord embed digest, its fields in a grid and its border green
 * on a calm day, red with an Alerts field on a breach. On the 1st of the month
 * it also posts the long-form monthly report (plain markdown content). Cron 02:30
 * UTC, after the rollup. All output is best-effort: a missing webhook or a post
 * failure is logged, never thrown.
 *
 * Copy rules: no em dashes, short declarative field values, sentence case. The
 * fields state the numbers; the border color and the Alerts field judge them.
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

/** Discord embed shape (the subset we send). Fields render 3-per-row inline. */
export interface EmbedField {
	name: string;
	value: string;
	inline?: boolean;
}
export interface DiscordEmbed {
	title: string;
	color: number;
	fields: EmbedField[];
	footer?: { text: string };
	timestamp?: string;
	/** A full-width image below the fields (the spend chart). */
	image?: { url: string };
}

/** Green for a calm day, red when any threshold breached. */
const COLOR_CALM = 0x57f287;
const COLOR_ALERT = 0xed4245;

/**
 * The actual OpenRouter charge for the day and how far our billing sat from it.
 * The invoice is pulled by a separate cron (01:40 UTC) and lags, so until it
 * lands this reads "awaiting invoice" rather than a number.
 */
function driftValue(t: DailyTotals): string {
	if (t.pulledCostUsd == null || t.driftPct == null) {
		return "awaiting invoice";
	}
	const dir = t.driftPct >= 0 ? "billed under" : "billed over";
	return `${money(t.pulledCostUsd)}\n${Math.abs(t.driftPct).toFixed(1)}% ${dir}`;
}

/**
 * The daily digest as a Discord embed. Pure so it is unit-tested against
 * fixtures. Six inline fields fall into a 2x3 grid (runs, billed, OpenRouter /
 * credits, Railway, model). Any breach turns the border red and appends an
 * Alerts field; the fields state the numbers, the color and that field judge.
 */
export function buildDigestEmbed(
	t: DailyTotals,
	th: AlertThresholds,
): DiscordEmbed {
	const alerts = buildAlerts(t, th);
	const fields: EmbedField[] = [
		{
			name: "Runs",
			value: `${t.runs} total\n${t.aiReviewedRuns} AI-reviewed`,
			inline: true,
		},
		{ name: "Billed", value: money(t.meteredCostUsd), inline: true },
		{ name: "Actual (OpenRouter)", value: driftValue(t), inline: true },
		{
			name: "Credits",
			value:
				t.creditBalanceUsd == null
					? "not in yet"
					: `${money(t.creditBalanceUsd, 2)}\n~${creditRunwayMonths(
							t.creditBalanceUsd,
						).toFixed(1)} months`,
			inline: true,
		},
		{
			name: "Railway",
			value:
				t.railwayUsageUsd == null
					? "not in yet"
					: `${money(t.railwayUsageUsd, 2)} of ${money(RAILWAY_FLOOR, 2)}`,
			inline: true,
		},
		{
			name: "Review model",
			value: `${REVIEW_MODEL.label}\n${money(
				REVIEW_MODEL.inputUsdPerMTok,
				2,
			)}/M in, ${money(REVIEW_MODEL.outputUsdPerMTok, 2)}/M out`,
			inline: true,
		},
	];
	if (alerts.length > 0) {
		fields.push({
			name: "⚠️ Alerts",
			value: alerts.map((a) => a.replace("[ALERT] ", "")).join("\n\n"),
			inline: false,
		});
	}
	return {
		title: `Tripwire economics for ${shortDate(t.day)}`,
		color: alerts.length > 0 ? COLOR_ALERT : COLOR_CALM,
		fields,
		// The chart below has no text labels, so the legend rides in the footer:
		// 🟣 billed (what we charged) vs 🟡 actual (what OpenRouter charged).
		footer: { text: "🟣 billed   🟡 actual (OpenRouter)   ·   last 14 days" },
		timestamp: `${t.day}T02:30:00.000Z`,
	};
}

/** Blurple billed line, yellow actual line — the embed's accent and a warm
 * contrast, legible on the dark thumbnail. */
const CHART_BILLED: [number, number, number] = [88, 101, 242];
const CHART_ACTUAL: [number, number, number] = [254, 231, 92];

/**
 * The billed-vs-actual spend sparkline for the recent window as PNG bytes, or
 * null when there aren't two points to draw a line (a fresh install). A day
 * whose invoice hasn't posted falls back to its billed figure so the actual
 * line stays continuous rather than dropping to zero.
 */
export function buildSpendChart(points: DailyCostPoint[]): Uint8Array | null {
	if (points.length < 2) {
		return null;
	}
	// Two LINE series, not filled areas: the dither areas merged into a muddy
	// overlap where blurple met yellow, so strokes keep billed and actual
	// visibly separate on the shared scale.
	return renderSparklinePng(
		[
			{
				values: points.map((p) => p.pulledCostUsd ?? p.meteredCostUsd),
				color: CHART_ACTUAL,
			},
			{ values: points.map((p) => p.meteredCostUsd), color: CHART_BILLED },
		],
		{ width: 540, height: 180, thickness: 1, padding: 14 },
	);
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
type MultipartFn = (
	url: string,
	payloadJson: unknown,
	files: MultipartFile[],
) => Promise<{ ok: boolean }>;

export interface DigestDeps {
	db: Db;
	logger: Logger;
	webhookUrl?: string | null;
	thresholds?: AlertThresholds;
	now?: Date;
	postImpl?: PostFn;
	/** Injected for the dry-run and tests; production uses guardedPostMultipart. */
	postMultipartImpl?: MultipartFn;
}

/** How many recent days the spend sparkline spans. */
const CHART_DAYS = 14;
const CHART_FILENAME = "econ.png";

function resolveWebhook(deps: DigestDeps): string | null {
	return (
		deps.webhookUrl ??
		process.env.ECONOMICS_WEBHOOK_URL ??
		process.env.FEEDBACK_WEBHOOK_URL ??
		null
	);
}

export interface DigestPayload {
	content?: string;
	embeds?: DiscordEmbed[];
}

async function post(deps: DigestDeps, url: string, payload: DigestPayload) {
	const fn: PostFn = deps.postImpl ?? ((u, body) => guardedPost(u, body));
	const result = await fn(url, payload);
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
	await post(deps, webhookUrl, { content: formatMonthlyReport(summary) });
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

	const embed = buildDigestEmbed(totals, thresholds);
	// The spend chart rides as a full-width image attachment when there's enough
	// history to draw one; without it the embed posts as plain JSON.
	const chart = buildSpendChart(
		await economicsServices.getRecentDailyCosts(deps.db, day, CHART_DAYS),
	);
	if (chart) {
		embed.image = { url: `attachment://${CHART_FILENAME}` };
		const fn: MultipartFn =
			deps.postMultipartImpl ??
			((u, payload, files) => guardedPostMultipart(u, payload, files));
		const result = await fn(webhookUrl, { embeds: [embed] }, [
			{
				field: "files[0]",
				filename: CHART_FILENAME,
				bytes: chart,
				contentType: "image/png",
			},
		]);
		if (!result.ok) {
			deps.logger.warn("economics digest post failed");
		}
	} else {
		await post(deps, webhookUrl, { embeds: [embed] });
	}

	// On the 1st, the day that just closed is the last of the previous month.
	if (now.getUTCDate() === 1) {
		await postMonthlyReport(deps, day.slice(0, 7));
	}
	deps.logger.info(
		{ day, alerts: buildAlerts(totals, thresholds).length },
		"economics digest posted",
	);
}
