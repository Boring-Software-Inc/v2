import { useQuery } from "@tanstack/react-query";
import type { CostByOrgRow } from "@tripwire/db";
import { DitherChart } from "#/components/charts/dither-chart";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	economicsCostByOrgQueryOptions,
	economicsOverviewQueryOptions,
	economicsSeriesQueryOptions,
} from "#/lib/admin-economics.query";
import { cn } from "#/lib/utils";

const usd = (n: number, dp = 2) => `$${n.toFixed(dp)}`;

/** A number[] safe for DitherChart: never empty, nulls dropped. */
function seriesOf(values: (number | null)[]): number[] {
	const nums = values.filter((v): v is number => v != null);
	return nums.length > 0 ? nums : [0];
}

/** /admin/economics — platform unit economics. Staff only. */
export function EconomicsPage() {
	const overview = useQuery(economicsOverviewQueryOptions());
	const series = useQuery(economicsSeriesQueryOptions());
	const costByOrg = useQuery(economicsCostByOrgQueryOptions());

	const o = overview.data;
	const points = series.data ?? [];
	const overCeiling = o ? o.costPerRunUsd > o.costCeilingUsd : false;
	const floorPct = o?.railwayUsageUsd
		? Math.min(1, o.railwayUsageUsd / o.railwayFloorUsd)
		: 0;

	const cards = [
		{
			key: "cost-per-run",
			label: "cost per AI-reviewed run",
			value: o ? usd(o.costPerRunUsd, 4) : "–",
			sub: o ? `ceiling ${usd(o.costCeilingUsd, 4)}` : "",
			tone: overCeiling ? "text-danger" : undefined,
		},
		{
			key: "metered",
			label: "metered this month",
			value: o ? usd(o.meteredMtdUsd, 2) : "–",
			sub: o ? `of ${usd(o.accruedMtdUsd, 2)} accrued` : "",
		},
		{
			key: "drift",
			label: "drift",
			value: o?.driftPct == null ? "n/a" : `${o.driftPct.toFixed(1)}%`,
			sub: "metered vs pulled",
		},
		{
			key: "runs",
			label: "runs this month",
			value: o ? String(o.runs) : "–",
			sub: o ? `${o.aiReviewedRuns} AI-reviewed` : "",
		},
	];

	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<header className="mb-6">
					<h1 className="font-semibold text-2xl tracking-tight">Economics</h1>
					<p className="text-muted-foreground text-sm">
						platform unit economics. staff only.
					</p>
				</header>

				<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
					{cards.map((card) => (
						<div className="rounded-xl border bg-card px-4 py-3" key={card.key}>
							<p className="text-muted-foreground text-xs">{card.label}</p>
							<p
								className={cn(
									"font-semibold text-2xl tabular-nums tracking-tight",
									card.tone,
								)}
							>
								{card.value}
							</p>
							{card.sub ? (
								<p className="text-muted-foreground text-xs">{card.sub}</p>
							) : null}
						</div>
					))}
				</div>

				<div className="mt-6 grid gap-3 md:grid-cols-2">
					<div className="rounded-xl border bg-card p-4">
						<div className="mb-2 flex items-baseline justify-between">
							<p className="font-medium text-sm">credit burn-down</p>
							<p className="text-muted-foreground text-xs tabular-nums">
								{o?.creditBalanceUsd == null
									? "n/a"
									: `${usd(o.creditBalanceUsd)} · ${
											o.creditRunwayMonths?.toFixed(1) ?? "?"
										}mo`}
							</p>
						</div>
						<DitherChart
							className="h-24 w-full"
							color="purple"
							data={seriesOf(points.map((p) => p.creditBalanceUsd))}
						/>
					</div>

					<div className="rounded-xl border bg-card p-4">
						<div className="mb-2 flex items-baseline justify-between">
							<p className="font-medium text-sm">OpenRouter daily spend</p>
							<p className="text-muted-foreground text-xs">vs $1.00 cap</p>
						</div>
						<DitherChart
							className="h-24 w-full"
							color="orange"
							data={seriesOf(
								points.map((p) => p.pulledCostUsd ?? p.meteredCostUsd),
							)}
						/>
					</div>
				</div>

				<div className="mt-3 rounded-xl border bg-card p-4">
					<div className="mb-2 flex items-baseline justify-between">
						<p className="font-medium text-sm">Railway floor</p>
						<p className="text-muted-foreground text-xs tabular-nums">
							{o?.railwayUsageUsd == null
								? "n/a"
								: `${usd(o.railwayUsageUsd)} / ${usd(o.railwayFloorUsd)}`}
						</p>
					</div>
					<div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
						<div
							className={cn(
								"h-full rounded-full",
								floorPct >= 0.9 ? "bg-danger" : "bg-primary",
							)}
							style={{ width: `${Math.round(floorPct * 100)}%` }}
						/>
					</div>
				</div>

				<CostByOrgTable rows={costByOrg.data ?? []} />
			</div>
		</DashboardLayout>
	);
}

function CostByOrgTable({ rows }: { rows: CostByOrgRow[] }) {
	return (
		<div className="mt-6 rounded-xl border bg-card">
			<div className="border-b px-4 py-3">
				<p className="font-medium text-sm">cost by org</p>
				<p className="text-muted-foreground text-xs">
					this month. the unattributed row is unclaimed installs.
				</p>
			</div>
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b text-muted-foreground text-xs">
						<th className="px-4 py-2 text-left font-normal">org</th>
						<th className="px-4 py-2 text-right font-normal">runs</th>
						<th className="px-4 py-2 text-right font-normal">AI</th>
						<th className="px-4 py-2 text-right font-normal">metered</th>
					</tr>
				</thead>
				<tbody>
					{rows.length === 0 ? (
						<tr>
							<td
								className="px-4 py-6 text-center text-muted-foreground text-xs"
								colSpan={4}
							>
								no rolled-up days yet.
							</td>
						</tr>
					) : (
						rows.map((row) => {
							const unattributed = row.orgId === null;
							return (
								<tr
									className={cn(
										"border-b last:border-0",
										unattributed && "text-muted-foreground",
									)}
									key={row.orgId ?? "~unattributed"}
								>
									<td className="px-4 py-2">
										{unattributed
											? "unattributed"
											: (row.orgName ?? row.orgSlug)}
									</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{row.runs}
									</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{row.aiReviewedRuns}
									</td>
									<td className="px-4 py-2 text-right tabular-nums">
										{usd(row.meteredCostUsd, 4)}
									</td>
								</tr>
							);
						})
					)}
				</tbody>
			</table>
		</div>
	);
}
