import { describe, expect, test } from "bun:test";
import type { DailyTotals, MonthlySummary } from "@tripwire/db";
import {
	type AlertThresholds,
	buildAlerts,
	formatDigest,
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

describe("formatDigest", () => {
	test("three lines, real numbers, no em dashes", () => {
		const out = formatDigest(CALM);
		const lines = out.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe("Tripwire economics · Jul 21");
		expect(lines[1]).toBe("runs 14 (3 AI) · metered $0.0114 · drift 4.1% OK");
		expect(lines[2]).toBe(
			"credits $954.55 (21.2mo) · Railway $1.42/$5.00 · OR today $0.0119",
		);
		expect(out).not.toContain("—");
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
		expect(alerts[0]).toContain("OR daily spend $1.1200 exceeds $1.00 cap");
		expect(alerts[1]).toContain("drift 14.8% exceeds 10%");
		expect(alerts[2]).toContain("Railway usage $4.61 approaching $5.00 floor");
	});

	test("negative drift beyond the band still alerts", () => {
		const alerts = buildAlerts({ ...CALM, driftPct: -15 }, TH);
		expect(alerts.some((a) => a.includes("drift -15.0%"))).toBe(true);
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
		expect(out).toContain("# Economics: Jul 2026");
		// Accrued = Railway floor 5 + PlanetScale 45 + AI 1.87 = 51.87
		expect(out).toContain("Accrued: $51.87");
		expect(out).toContain("PlanetScale $45.00");
		expect(out).toContain("Runs 276 · AI-reviewed 41");
		expect(out).toContain("eval-key spend $3.90 excluded from COGS");
		expect(out).toContain("unattributed rows: 16 runs");
		expect(out).not.toContain("—");
	});

	test("cash view applies the OpenRouter credit fee", () => {
		const out = formatMonthlyReport(summary);
		// Cash = Railway 5 + AI 1.87 * 1.055 = 6.97
		expect(out).toContain("Cash: $6.97");
	});
});
