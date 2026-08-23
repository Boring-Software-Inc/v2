import { describe, expect, test } from "bun:test";
import type { DailyCostPoint, DailyTotals, MonthlySummary } from "@tripwire/db";
import {
	type AlertThresholds,
	buildAlerts,
	buildDigestEmbed,
	buildSpendChart,
	formatMonthlyReport,
} from "./economics-digest.ts";

const TH: AlertThresholds = {
	orDailyCapUsd: 1.0,
	driftAlertPct: 10,
	railwayFloorWarnUsd: 4.5,
};

const CALM: DailyTotals = {
	day: "2026-07-21",
	runs: 14,
	aiReviewedRuns: 3,
	meteredCostUsd: 0.0114,
	unattributedRuns: 0,
	unattributedCostUsd: 0,
	pulledCostUsd: 0.0119,
	driftPct: 4.1,
	creditBalanceUsd: 954.55,
	railwayUsageUsd: 1.42,
};

describe("buildDigestEmbed", () => {
	const field = (embed: ReturnType<typeof buildDigestEmbed>, name: string) =>
		embed.fields.find((f) => f.name === name)?.value;

	test("calm day: green border, the six grid fields, real numbers", () => {
		const embed = buildDigestEmbed(CALM, TH);
		expect(embed.color).toBe(0x57f287);
		expect(embed.title).toBe("Tripwire economics for Jul 21");
		expect(field(embed, "Runs")).toBe("14 total\n3 AI-reviewed");
		expect(field(embed, "Billed")).toBe("$0.0114");
		expect(field(embed, "Actual (OpenRouter)")).toBe(
			"$0.0119\n4.1% billed under",
		);
		expect(field(embed, "Credits")).toBe("$954.55\n~21.2 months");
		expect(field(embed, "Railway")).toBe("$1.42 of $5.00");
		// The model rate the user asked to surface, from the REVIEW_MODEL constant.
		expect(field(embed, "Review model")).toBe(
			"grok-4.5\n$2.00/M in, $6.00/M out",
		);
		// No alerts field on a calm day; the six grid fields are inline.
		expect(embed.fields).toHaveLength(6);
		expect(embed.fields.every((f) => f.inline)).toBe(true);
	});

	test("a day billed over actual reads 'over', never a hardcoded OK", () => {
		const embed = buildDigestEmbed({ ...CALM, driftPct: -8.2 }, TH);
		expect(field(embed, "Actual (OpenRouter)")).toBe(
			"$0.0119\n8.2% billed over",
		);
		expect(JSON.stringify(embed)).not.toContain("OK");
	});

	test("a breach turns the border red and appends an Alerts field", () => {
		const hot: DailyTotals = {
			...CALM,
			pulledCostUsd: 1.12,
			driftPct: 14.8,
			meteredCostUsd: 0.21,
		};
		const embed = buildDigestEmbed(hot, TH);
		expect(embed.color).toBe(0xed4245);
		const alerts = field(embed, "⚠️ Alerts");
		expect(alerts).toContain("Billing drifted 14.8% from actual");
		expect(alerts).not.toContain("[ALERT]");
	});

	test("missing pulled cost renders 'awaiting invoice', no crash", () => {
		const embed = buildDigestEmbed(
			{ ...CALM, pulledCostUsd: null, driftPct: null },
			TH,
		);
		expect(field(embed, "Actual (OpenRouter)")).toBe("awaiting invoice");
	});
});

describe("buildAlerts", () => {
	test("calm day raises nothing", () => {
		expect(buildAlerts(CALM, TH)).toHaveLength(0);
	});

	test("breaches raise one line each", () => {
		const hot: DailyTotals = {
			...CALM,
			pulledCostUsd: 1.12,
			driftPct: 14.8,
			railwayUsageUsd: 4.61,
			meteredCostUsd: 0.21,
		};
		const alerts = buildAlerts(hot, TH);
		expect(alerts).toHaveLength(3);
		expect(alerts[0]).toContain(
			"OpenRouter spend hit $1.1200 today, over the $1.00 cap",
		);
		expect(alerts[1]).toContain("Billing drifted 14.8% from actual");
		expect(alerts[1]).toContain("over the 10% limit");
		expect(alerts[2]).toContain(
			"Railway usage is $4.61, close to the $5.00 floor",
		);
	});

	test("negative drift beyond the band still alerts", () => {
		const alerts = buildAlerts({ ...CALM, driftPct: -15 }, TH);
		expect(alerts.some((a) => a.includes("drifted -15.0% from actual"))).toBe(
			true,
		);
	});
});

describe("formatMonthlyReport", () => {
	const summary: MonthlySummary = {
		month: "2026-07",
		runs: 276,
		aiReviewedRuns: 41,
		meteredCostUsd: 1.87,
		driftAvgPct: 4.2,
		creditBalanceUsd: 954.55,
		railwayUsageUsd: 1.42,
		unattributedRuns: 16,
		unattributedCostUsd: 0.01,
		evalSpendUsd: 3.9,
	};

	test("accrued and cash views, flags, no em dashes", () => {
		const out = formatMonthlyReport(summary);
		expect(out).toContain("# Economics for Jul 2026");
		// Accrued = Railway floor 5 + PlanetScale 45 + AI 1.87 = 51.87
		expect(out).toContain("Accrued cost was $51.87");
		expect(out).toContain("PlanetScale $45.00");
		expect(out).toContain("276 change requests, 41 through the AI reviewer");
		expect(out).toContain("$3.90 of eval-key spend is excluded from COGS");
		expect(out).toContain("16 runs");
		expect(out).not.toContain("—");
	});

	test("cash view applies the OpenRouter credit fee", () => {
		const out = formatMonthlyReport(summary);
		// Cash = Railway 5 + AI 1.87 * 1.055 = 6.97
		expect(out).toContain("Cash out was $6.97");
	});
});

describe("buildSpendChart", () => {
	const points = (n: number): DailyCostPoint[] =>
		Array.from({ length: n }, (_, i) => ({
			day: `2026-07-${String(i + 1).padStart(2, "0")}`,
			meteredCostUsd: 0.01 + i * 0.001,
			pulledCostUsd: 0.012 + i * 0.001,
		}));

	test("under two points draws nothing", () => {
		expect(buildSpendChart([])).toBeNull();
		expect(buildSpendChart(points(1))).toBeNull();
	});

	test("two or more points yield a PNG (signature bytes)", () => {
		const png = buildSpendChart(points(14));
		expect(png).not.toBeNull();
		expect(Array.from((png as Uint8Array).slice(0, 4))).toEqual([
			137, 80, 78, 71,
		]);
	});

	test("a day with no invoice falls back to billed, still renders", () => {
		const withGap = points(3).map((p, i) =>
			i === 1 ? { ...p, pulledCostUsd: null } : p,
		);
		expect(buildSpendChart(withGap)).not.toBeNull();
	});
});
