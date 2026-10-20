import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CostByOrgRow, RailwayBreakdown } from "@tripwire/db";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#/components/glaze/ui/alert";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Chart } from "#/components/glaze/ui/chart";
import {
	DataList,
	DataListItem,
	DataListLabel,
	DataListValue,
} from "#/components/glaze/ui/data-list";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "#/components/glaze/ui/progress";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/components/glaze/ui/table";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	economicsCostByOrgQueryOptions,
	economicsOverviewQueryOptions,
	economicsRailwayQueryOptions,
	economicsSeriesQueryOptions,
} from "#/lib/admin-economics.query";

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

function dayLabel(value: unknown): string {
	const date = new Date(`${String(value)}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) {
		return String(value);
	}
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export function EconomicsPage() {
	const overview = useQuery(economicsOverviewQueryOptions());
	const series = useQuery(economicsSeriesQueryOptions());
	const costByOrg = useQuery(economicsCostByOrgQueryOptions());
	const railway = useQuery(economicsRailwayQueryOptions());

	const o = overview.data;
	const points = series.data ?? [];
	const overCeiling = o ? o.costPerRunUsd > o.costCeilingUsd : false;

	const creditRows = points.map((p) => ({
		day: p.day,
		credit: p.creditBalanceUsd,
	}));
	const spendRows = points.map((p) => ({
		day: p.day,
		spend: p.pulledCostUsd ?? p.meteredCostUsd,
	}));
	const seriesError = series.error
		? "Tripwire couldn't load the daily numbers. Reload the page to try again."
		: null;

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Economics</h1>
						<p className="max-w-measure type-body text-text-2">
							What Tripwire costs to run, and where the money goes. The totals
							update once a day, so today's numbers stay low until the nightly
							update.
						</p>
					</header>

					<section aria-label="This month" className="flex flex-col gap-4">
						{o ? (
							<p className="type-heading-sm">
								An AI-reviewed run costs{" "}
								<span className="tabular-nums">{usd(o.costPerRunUsd, 4)}</span>{" "}
								on average, against a target under{" "}
								<span className="tabular-nums">{usd(o.costCeilingUsd, 4)}</span>
								.{" "}
								{overCeiling ? (
									<Badge className="align-middle" variant="fail">
										Over target
									</Badge>
								) : null}
							</p>
						) : (
							<SkeletonText className="w-96 max-w-full" type="heading-sm" />
						)}
						<DataList variant="panel">
							<DataListItem>
								<DataListLabel>AI spend this month</DataListLabel>
								<DataListValue>
									{o ? (
										<span className="flex flex-col">
											<span className="tabular-nums">
												{usd(o.meteredMtdUsd, 2)}
											</span>
											<span className="type-caption text-text-2">
												AI model spend recorded so far this month. With fixed
												hosting costs added, the total is{" "}
												{usd(o.accruedMtdUsd, 2)}.
											</span>
										</span>
									) : null}
								</DataListValue>
							</DataListItem>
							<DataListItem>
								<DataListLabel>Difference from invoice</DataListLabel>
								<DataListValue>
									<span className="flex flex-col">
										<span className="tabular-nums">
											{o?.driftPct == null
												? "None"
												: `${o.driftPct.toFixed(1)}%`}
										</span>
										<span className="type-caption text-text-2">
											How far the recorded cost is from the provider's invoice.
											Under 10% is normal.
										</span>
									</span>
								</DataListValue>
							</DataListItem>
							<DataListItem>
								<DataListLabel>Runs this month</DataListLabel>
								<DataListValue>
									{o ? (
										<span className="flex flex-col">
											<span className="tabular-nums">{o.runs}</span>
											<span className="type-caption text-text-2">
												Checks of change requests. {o.aiReviewedRuns} of them
												used AI review.
											</span>
										</span>
									) : null}
								</DataListValue>
							</DataListItem>
						</DataList>
					</section>

					<div className="grid gap-4 md:grid-cols-2">
						<Chart
							area
							config={{
								day: { label: "Day" },
								credit: { label: "Credit left" },
							}}
							data={creditRows}
							description={
								o?.creditBalanceUsd == null
									? "PlanetScale database credit left on each day. It goes down as the database bill grows."
									: `PlanetScale database credit left on each day. ${usd(o.creditBalanceUsd)} is left. At the current rate, that lasts ${
											o.creditRunwayMonths?.toFixed(1) ?? "an unknown number of"
										} months.`
							}
							empty="No daily totals yet"
							error={seriesError}
							height={140}
							label="Database credit left, by day"
							loading={series.isLoading}
							onRetry={() => series.refetch()}
							title="Database credit left"
							type="line"
							valueFormat={(v) => usd(v)}
							xFormat={dayLabel}
							xKey="day"
						/>
						<Chart
							config={{ day: { label: "Day" }, spend: { label: "Spend" } }}
							data={spendRows}
							description="AI model cost per day, from the OpenRouter invoice. If a day costs more than $1.00, the daily report shows an alert."
							empty="No daily totals yet"
							error={seriesError}
							height={140}
							label="AI spend per day, from OpenRouter"
							loading={series.isLoading}
							onRetry={() => series.refetch()}
							title="AI spend per day"
							type="bar"
							valueFormat={(v) => usd(v)}
							xFormat={dayLabel}
							xKey="day"
						/>
					</div>

					<RailwaySection
						data={railway.data ?? null}
						loading={railway.isLoading}
					/>

					<CostByOrgTable
						loading={costByOrg.isLoading}
						rows={costByOrg.data ?? []}
					/>
				</div>
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
	return (
		<section aria-labelledby="railway-floor" className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<h2 className="type-heading-sm" id="railway-floor">
					Hosting on Railway
				</h2>
				<p className="max-w-measure type-body-sm text-text-2">
					Hosting cost for each service in this billing period, from Railway.
					The Railway plan includes $5.00 of usage each month. Usage above that
					is added to the bill.
				</p>
			</div>

			{data?.ratesDrift ? (
				<Alert status="warn">
					<AlertTitle>Railway pricing changed</AlertTitle>
					<AlertDescription>
						Check the rates in railway-rates.ts again. Until you do, the dollar
						amounts below may be wrong.
					</AlertDescription>
				</Alert>
			) : null}

			{data ? (
				<Progress
					max={RAILWAY_FLOOR_USD}
					mode="meter"
					value={Math.min(total, RAILWAY_FLOOR_USD)}
					warnAt={0.9}
				>
					<ProgressLabel>Included usage</ProgressLabel>
					<ProgressValue>
						{() => `${usd(total)} of ${usd(RAILWAY_FLOOR_USD)}`}
					</ProgressValue>
				</Progress>
			) : null}

			<Table
				aria-busy={loading || undefined}
				aria-label="Railway usage by service"
				footer={
					data ? (
						<span>
							Each column shows the usage that the cost comes from. Last updated{" "}
							{pulledAgo(data.lastPulledAt)}.
						</span>
					) : undefined
				}
			>
				<TableHeader>
					<TableRow>
						<TableHead>Service</TableHead>
						<TableHead numeric>CPU minutes</TableHead>
						<TableHead numeric>Memory GB-minutes</TableHead>
						<TableHead numeric>Outbound data GB</TableHead>
						<TableHead numeric>Cost</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{loading ? (
						<TableLoading
							columns={[
								{},
								{ numeric: true },
								{ numeric: true },
								{ numeric: true },
								{ numeric: true },
							]}
							rows={3}
						/>
					) : data === null ? (
						<TableEmpty
							art={<MascotArt mood="admin-table-empty" size="compact" />}
							colSpan={5}
							description="Tripwire could not reach Railway, or it has not loaded data yet. Check that RAILWAY_API_TOKEN is set to an account token."
							reason="error"
							title="No Railway data yet"
							action={
								<Button
									nativeButton={false}
									render={<Link to="/admin/orgs" />}
									size="sm"
									variant="secondary"
								>
									View orgs
								</Button>
							}
						/>
					) : data.services.length === 0 ? (
						<TableEmpty
							art={<MascotArt mood="admin-table-empty" size="compact" />}
							colSpan={5}
							title="No services billed yet"
							action={
								<Button
									nativeButton={false}
									render={<Link to="/admin/orgs" />}
									size="sm"
									variant="secondary"
								>
									View orgs
								</Button>
							}
						/>
					) : (
						data.services.map((s) => (
							<TableRow key={s.name}>
								<TableCell mono>{s.name}</TableCell>
								<TableCell numeric>{s.cpuUnits.toFixed(0)}</TableCell>
								<TableCell numeric>{s.memGbMin.toFixed(0)}</TableCell>
								<TableCell numeric>{s.egressGb.toFixed(2)}</TableCell>
								<TableCell numeric>{usd(s.costUsd, 4)}</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</section>
	);
}

function CostByOrgTable({
	rows,
	loading,
}: {
	rows: CostByOrgRow[];
	loading: boolean;
}) {
	return (
		<section aria-labelledby="cost-by-org" className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<h2 className="type-heading-sm" id="cost-by-org">
					Cost by org
				</h2>
				<p className="max-w-measure type-body-sm text-text-2">
					AI model spend for each org this month. "No org" is usage from
					installations that no org has claimed yet.
				</p>
			</div>
			<Table aria-busy={loading || undefined} aria-label="Cost by org">
				<TableHeader>
					<TableRow>
						<TableHead>Org</TableHead>
						<TableHead numeric>Runs</TableHead>
						<TableHead numeric>AI reviews</TableHead>
						<TableHead numeric>AI cost</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{loading ? (
						<TableLoading
							columns={[
								{},
								{ numeric: true },
								{ numeric: true },
								{ numeric: true },
							]}
							rows={3}
						/>
					) : rows.length === 0 ? (
						<TableEmpty
							art={<MascotArt mood="admin-table-empty" size="compact" />}
							colSpan={4}
							description="Orgs appear here after their first run this month."
							title="No AI spend this month yet"
							action={
								<Button
									nativeButton={false}
									render={<Link to="/admin/orgs" />}
									size="sm"
									variant="secondary"
								>
									View orgs
								</Button>
							}
						/>
					) : (
						rows.map((row) => {
							const unattributed = row.orgId === null;
							return (
								<TableRow key={row.orgId ?? "~unattributed"}>
									<TableCell
										className={unattributed ? "text-text-2" : undefined}
									>
										{unattributed ? "No org" : (row.orgName ?? row.orgSlug)}
									</TableCell>
									<TableCell numeric>{row.runs}</TableCell>
									<TableCell numeric>{row.aiReviewedRuns}</TableCell>
									<TableCell numeric>{usd(row.meteredCostUsd, 4)}</TableCell>
								</TableRow>
							);
						})
					)}
				</TableBody>
			</Table>
		</section>
	);
}
