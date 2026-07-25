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
	test("plain sentences, real numbers, no em dashes", () => {
		const out = formatDigest(CALM);
		const lines = out.split("\n");
		expect(lines).toHaveLength(4);
		expect(lines[0]).toBe("Tripwire economics for Jul 21.");
		expect(lines[1]).toBe("14 change requests ran, 3 through the AI reviewer.");
		expect(lines[2]).toBe(
			"We billed $0.0114. OpenRouter charged $0.0119, so billing ran 4.1% under.",
		);
		expect(lines[3]).toBe(
			"Credits $954.55, about 21.2 months of runway. Railway $1.42 of $5.00.",
		);
		expect(out).not.toContain("—");
	});

	test("a day billed over actual reads 'over', never a hardcoded OK", () => {
		const out = formatDigest({ ...CALM, driftPct: -8.2 });
		expect(out).toContain("so billing ran 8.2% over.");
		expect(out).not.toContain("OK");
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
