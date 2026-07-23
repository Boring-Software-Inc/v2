import { useQuery } from "@tanstack/react-query";
import type { CostByOrgRow, RailwayBreakdown } from "@tripwire/db";
import { DitherChart } from "#/components/charts/dither-chart";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	economicsCostByOrgQueryOptions,
	economicsOverviewQueryOptions,
	economicsRailwayQueryOptions,
	economicsSeriesQueryOptions,
} from "#/lib/admin-economics.query";
import { cn } from "#/lib/utils";

const RAILWAY_FLOOR_USD = 5;

function pulledAgo(iso: string): string {
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) {
		return "unknown";
	}
	const mins = Math.round((Date.now() - then) / 60000);
	if (mins < 60) {
		return `${mins}m ago`;
	}
	const hrs = Math.round(mins / 60);
	return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

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
	const railway = useQuery(economicsRailwayQueryOptions());

	const o = overview.data;
	const points = series.data ?? [];
	const overCeiling = o ? o.costPerRunUsd > o.costCeilingUsd : false;

	const cards = [
		{
			key: "cost-per-run",
			label: "cost per AI-reviewed run",
			value: o ? usd(o.costPerRunUsd, 4) : "–",
			sub: o
				? `average model spend per reviewed change request. target under ${usd(o.costCeilingUsd, 4)}.`
				: "",
			tone: overCeiling ? "text-danger" : undefined,
		},
		{
			key: "metered",
			label: "AI spend this month",
			value: o ? usd(o.meteredMtdUsd, 2) : "–",
			sub: o
				? `model spend recorded so far. part of the ${usd(o.accruedMtdUsd, 2)} total once fixed hosting is added.`
				: "",
		},
		{
			key: "drift",
			label: "drift",
			value: o?.driftPct == null ? "n/a" : `${o.driftPct.toFixed(1)}%`,
			sub: "gap between what we recorded and the provider invoice. under 10% is healthy.",
		},
		{
			key: "runs",
			label: "runs this month",
			value: o ? String(o.runs) : "–",
			sub: o
				? `gate runs on change requests. ${o.aiReviewedRuns} of them used AI review.`
				: "",
		},
	];

	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<header className="mb-6">
					<h1 className="font-semibold text-2xl tracking-tight">Economics</h1>
					<p className="text-muted-foreground text-sm">
						what the platform costs to run and where the money goes. staff only.
						numbers roll up once a day, so today reads low until tonight.
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
						<div className="flex items-baseline justify-between">
							<p className="font-medium text-sm">credit burn-down</p>
							<p className="text-muted-foreground text-xs tabular-nums">
								{o?.creditBalanceUsd == null
									? "n/a"
									: `${usd(o.creditBalanceUsd)} · ${
											o.creditRunwayMonths?.toFixed(1) ?? "?"
										}mo`}
							</p>
						</div>
						<p className="mt-0.5 mb-2 text-muted-foreground text-xs">
							PlanetScale credit left, day by day. it falls as the database bill
							accrues. the label is dollars remaining and months of runway at
							the current rate.
						</p>
						<DitherChart
							className="h-24 w-full"
							color="purple"
							data={seriesOf(points.map((p) => p.creditBalanceUsd))}
						/>
					</div>

					<div className="rounded-xl border bg-card p-4">
						<div className="flex items-baseline justify-between">
							<p className="font-medium text-sm">OpenRouter daily spend</p>
							<p className="text-muted-foreground text-xs">vs $1.00 cap</p>
						</div>
						<p className="mt-0.5 mb-2 text-muted-foreground text-xs">
							AI model cost per day, from the provider invoice. a day above the
							$1.00 cap raises an alert in the digest.
						</p>
						<DitherChart
							className="h-24 w-full"
							color="orange"
							data={seriesOf(
								points.map((p) => p.pulledCostUsd ?? p.meteredCostUsd),
							)}
						/>
					</div>
				</div>

				<RailwaySection
					data={railway.data ?? null}
					loading={railway.isLoading}
				/>

				<CostByOrgTable rows={costByOrg.data ?? []} />
			</div>
		</DashboardLayout>
	);
}

function RailwaySection({
	data,
	loading,
}: {
	data: RailwayBreakdown | null;
	loading: boolean;
}) {
	const total = data?.totalUsd ?? 0;
	const floorPct = Math.min(1, total / RAILWAY_FLOOR_USD);
	return (
		<div className="mt-3 rounded-xl border bg-card p-4">
			<div className="flex items-baseline justify-between">
				<p className="font-medium text-sm">Railway floor</p>
				<p className="text-muted-foreground text-xs tabular-nums">
					{data ? `${usd(total)} / ${usd(RAILWAY_FLOOR_USD)}` : "no data"}
				</p>
			</div>
			<p className="mt-0.5 mb-2 text-muted-foreground text-xs">
				hosting usage this billing period, pulled from Railway and priced per
				service. it counts against the $5.00 the plan includes each month. spend
				past that starts adding to the bill.
			</p>

			{data?.ratesDrift ? (
				<p className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-danger text-xs">
					Railway pricing changed. re-verify the rates in railway-rates.ts. the
					dollars below may be wrong until then.
				</p>
			) : null}

			<div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
				<div
					className={cn(
						"h-full rounded-full",
						floorPct >= 0.9 ? "bg-danger" : "bg-primary",
					)}
					style={{ width: `${Math.round(floorPct * 100)}%` }}
				/>
			</div>

			{data === null ? (
				<p className="mt-3 text-muted-foreground text-xs">
					{loading
						? "loading."
						: "could not reach Railway, or no pull has run yet. set RAILWAY_API_TOKEN to an account token."}
				</p>
			) : (
				<>
					<table className="mt-3 w-full text-xs">
						<thead>
							<tr className="text-muted-foreground">
								<th className="py-1 text-left font-normal">service</th>
								<th className="py-1 text-right font-normal">vCPU-min</th>
								<th className="py-1 text-right font-normal">GB-min</th>
								<th className="py-1 text-right font-normal">egress GB</th>
								<th className="py-1 text-right font-normal">cost</th>
							</tr>
						</thead>
						<tbody>
							{data.services.map((s) => (
								<tr className="border-surface-2 border-t" key={s.name}>
									<td className="py-1">{s.name}</td>
									<td className="py-1 text-right tabular-nums">
										{s.cpuUnits.toFixed(0)}
									</td>
									<td className="py-1 text-right tabular-nums">
										{s.memGbMin.toFixed(0)}
									</td>
									<td className="py-1 text-right tabular-nums">
										{s.egressGb.toFixed(2)}
									</td>
									<td className="py-1 text-right tabular-nums">
										{usd(s.costUsd, 4)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<p className="mt-2 text-muted-foreground text-xs">
						the quantities are the raw usage behind each dollar figure. last
						pulled {pulledAgo(data.lastPulledAt)}.
					</p>
				</>
			)}
		</div>
	);
}

function CostByOrgTable({ rows }: { rows: CostByOrgRow[] }) {
	return (
		<div className="mt-6 rounded-xl border bg-card">
			<div className="border-b px-4 py-3">
				<p className="font-medium text-sm">cost by org</p>
				<p className="text-muted-foreground text-xs">
					AI model spend split by organization this month. the unattributed row
					is usage from installs no org has claimed yet.
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
