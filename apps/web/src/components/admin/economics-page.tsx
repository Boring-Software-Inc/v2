import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CostByOrgRow, RailwayBreakdown } from "@tripwire/db";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import {
	ActionRow,
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "#/design-system/ui/alert";
import { Badge } from "#/design-system/ui/badge";
import { Button } from "#/design-system/ui/button";
import { Chart } from "#/design-system/ui/chart";
import {
	DataList,
	DataListItem,
	DataListLabel,
	DataListValue,
} from "#/design-system/ui/data-list";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "#/design-system/ui/progress";
import { SkeletonText } from "#/design-system/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/design-system/ui/table";
import {
	DataValue,
	Subheading,
	SupportingText,
} from "#/design-system/ui/typography";
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

const usd = (value: number, decimalPlaces = 2) =>
	`$${value.toFixed(decimalPlaces)}`;

function dayLabel(value: string): string {
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) {
		return value;
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

	const current = overview.data;
	const points = series.data ?? [];
	const overCeiling = current
		? current.costPerRunUsd > current.costCeilingUsd
		: false;

	const creditRows = points.map((point) => ({
		day: point.day,
		credit: point.creditBalanceUsd,
	}));
	const spendRows = points.map((point) => ({
		day: point.day,
		spend: point.pulledCostUsd ?? point.meteredCostUsd,
	}));
	const seriesError = series.error
		? "Tripwire couldn't load the daily numbers."
		: null;

	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader
					description="Run cost, provider drift, remaining credit and spend by org. Daily totals update after the nightly pull."
					title="Economics"
				/>
				<PageBody>
					<Section id="economics-month">
						<SectionHeader title="This month" />
						<SectionBody>
							{overview.error ? (
								<Alert status="fail">
									<AlertTitle>
										Tripwire couldn't load this month's totals
									</AlertTitle>
									<AlertDescription>{overview.error.message}</AlertDescription>
									<AlertAction>
										<Button
											disabled={overview.isFetching}
											onClick={() => void overview.refetch()}
											size="sm"
											variant="secondary"
										>
											Load totals again
										</Button>
									</AlertAction>
								</Alert>
							) : current ? (
								<div data-layout-role="economics-lead">
									<Subheading level={3}>
										An AI-reviewed run costs{" "}
										<DataValue>{usd(current.costPerRunUsd, 4)}</DataValue> on
										average, against a target under{" "}
										<DataValue>{usd(current.costCeilingUsd, 4)}</DataValue>.
									</Subheading>
									{overCeiling ? (
										<Badge variant="fail">Over target</Badge>
									) : null}
								</div>
							) : (
								<SkeletonText
									data-layout-size="economics-lead"
									type="heading-sm"
								/>
							)}
							<DataList variant="panel">
								<DataListItem>
									<DataListLabel>AI spend this month</DataListLabel>
									<DataListValue>
										{current ? (
											<span data-layout-role="economics-value">
												<DataValue>{usd(current.meteredMtdUsd)}</DataValue>
												<SupportingText as="span">
													AI model spend recorded so far. With fixed hosting,
													the accrued total is {usd(current.accruedMtdUsd)}.
												</SupportingText>
											</span>
										) : null}
									</DataListValue>
								</DataListItem>
								<DataListItem>
									<DataListLabel>Difference from invoice</DataListLabel>
									<DataListValue>
										{current ? (
											<span data-layout-role="economics-value">
												<DataValue>
													{current.driftPct == null
														? "None"
														: `${current.driftPct.toFixed(1)}%`}
												</DataValue>
												<SupportingText as="span">
													Recorded model cost compared with the provider
													invoice. Under 10% is normal.
												</SupportingText>
											</span>
										) : null}
									</DataListValue>
								</DataListItem>
								<DataListItem>
									<DataListLabel>Runs this month</DataListLabel>
									<DataListValue>
										{current ? (
											<span data-layout-role="economics-value">
												<DataValue>{current.runs}</DataValue>
												<SupportingText as="span">
													Checks of change requests. {current.aiReviewedRuns}{" "}
													used AI review.
												</SupportingText>
											</span>
										) : null}
									</DataListValue>
								</DataListItem>
							</DataList>
						</SectionBody>
					</Section>

					<div data-layout-role="economics-charts">
						<Chart
							area
							config={{
								day: { label: "Day" },
								credit: { label: "Credit left" },
							}}
							data={creditRows}
							description={
								current?.creditBalanceUsd == null
									? "PlanetScale database credit left on each day."
									: `PlanetScale database credit left on each day. ${usd(current.creditBalanceUsd)} is left. At the current rate, that lasts ${current.creditRunwayMonths?.toFixed(1) ?? "an unknown number of"} months.`
							}
							empty="No daily totals yet"
							error={seriesError}
							height={140}
							label="Database credit left, by day"
							loading={series.isLoading}
							onRetry={() => series.refetch()}
							title="Database credit left"
							type="line"
							valueFormat={(value) => usd(value)}
							xFormat={(value) => dayLabel(String(value))}
							xKey="day"
						/>
						<Chart
							config={{ day: { label: "Day" }, spend: { label: "Spend" } }}
							data={spendRows}
							description="AI model cost per day from the OpenRouter invoice. The daily report alerts when a day costs more than $1.00."
							empty="No daily totals yet"
							error={seriesError}
							height={140}
							label="AI spend per day, from OpenRouter"
							loading={series.isLoading}
							onRetry={() => series.refetch()}
							title="AI spend per day"
							type="bar"
							valueFormat={(value) => usd(value)}
							xFormat={(value) => dayLabel(String(value))}
							xKey="day"
						/>
					</div>

					<RailwaySection
						data={railway.data ?? null}
						error={railway.error}
						loading={railway.isLoading}
						onRetry={() => railway.refetch()}
					/>

					<CostByOrgTable
						error={costByOrg.error}
						loading={costByOrg.isLoading}
						onRetry={() => costByOrg.refetch()}
						rows={costByOrg.data ?? []}
					/>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}

function RailwaySection({
	data,
	loading,
	error,
	onRetry,
}: {
	data: RailwayBreakdown | null;
	loading: boolean;
	error: Error | null;
	onRetry: () => unknown;
}) {
	const total = data?.totalUsd ?? 0;
	return (
		<Section id="economics-railway">
			<SectionHeader
				description="Service usage in the current Railway billing period. The plan includes $5.00 each month."
				title="Hosting on Railway"
			/>
			<SectionBody>
				{data?.ratesDrift ? (
					<Alert status="warn">
						<AlertTitle>Railway pricing changed</AlertTitle>
						<AlertDescription>
							Check the rates in railway-rates.ts. Until then, the dollar
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
					data-admin-table="railway"
					footer={
						data ? (
							<SupportingText as="span">
								Each column shows the usage behind the cost. Last updated{" "}
								{pulledAgo(data.lastPulledAt)}.
							</SupportingText>
						) : undefined
					}
				>
					<TableHeader>
						<TableRow>
							<TableHead>Service</TableHead>
							<TableHead numeric>CPU minutes</TableHead>
							<TableHead data-admin-column="railway-memory" numeric>
								Memory GB-minutes
							</TableHead>
							<TableHead data-admin-column="railway-egress" numeric>
								Outbound data GB
							</TableHead>
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
						) : error || data === null ? (
							<TableEmpty
								action={
									<ActionRow
										primary={
											<Button onClick={onRetry} size="sm" variant="secondary">
												Load Railway usage again
											</Button>
										}
										secondary={
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
								}
								art={<MascotArt mood="admin-table-empty" size="compact" />}
								colSpan={5}
								description={
									error?.message ??
									"Check that RAILWAY_API_TOKEN is set to an account token."
								}
								reason="error"
								title="No Railway data yet"
							/>
						) : data.services.length === 0 ? (
							<TableEmpty
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
								art={<MascotArt mood="admin-table-empty" size="compact" />}
								colSpan={5}
								description="Services appear after Railway reports usage for this billing period."
								title="No services billed yet"
							/>
						) : (
							data.services.map((service) => (
								<TableRow key={service.name}>
									<TableCell mono>{service.name}</TableCell>
									<TableCell numeric>{service.cpuUnits.toFixed(0)}</TableCell>
									<TableCell data-admin-column="railway-memory" numeric>
										{service.memGbMin.toFixed(0)}
									</TableCell>
									<TableCell data-admin-column="railway-egress" numeric>
										{service.egressGb.toFixed(2)}
									</TableCell>
									<TableCell numeric>{usd(service.costUsd, 4)}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</SectionBody>
		</Section>
	);
}

function CostByOrgTable({
	rows,
	loading,
	error,
	onRetry,
}: {
	rows: CostByOrgRow[];
	loading: boolean;
	error: Error | null;
	onRetry: () => unknown;
}) {
	return (
		<Section id="economics-org-cost">
			<SectionHeader
				description='AI model spend for each org this month. "No org" is usage from an unclaimed installation.'
				title="Cost by org"
			/>
			<SectionBody>
				<Table
					aria-busy={loading || undefined}
					aria-label="Cost by org"
					data-admin-table="org-cost"
				>
					<TableHeader>
						<TableRow>
							<TableHead>Org</TableHead>
							<TableHead numeric>Runs</TableHead>
							<TableHead data-admin-column="org-cost-ai-reviews" numeric>
								AI reviews
							</TableHead>
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
						) : error ? (
							<TableEmpty
								action={
									<ActionRow
										primary={
											<Button onClick={onRetry} size="sm" variant="secondary">
												Load org costs again
											</Button>
										}
										secondary={
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
								}
								colSpan={4}
								description={error.message}
								reason="error"
								title="Tripwire couldn't load org costs"
							/>
						) : rows.length === 0 ? (
							<TableEmpty
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
								art={<MascotArt mood="admin-table-empty" size="compact" />}
								colSpan={4}
								description="Orgs appear after their first run this month."
								title="No AI spend this month yet"
							/>
						) : (
							rows.map((row) => (
								<TableRow key={row.orgId ?? "~unattributed"}>
									<TableCell>
										{row.orgId === null
											? "No org"
											: (row.orgName ?? row.orgSlug)}
									</TableCell>
									<TableCell numeric>{row.runs}</TableCell>
									<TableCell data-admin-column="org-cost-ai-reviews" numeric>
										{row.aiReviewedRuns}
									</TableCell>
									<TableCell numeric>{usd(row.meteredCostUsd, 4)}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</SectionBody>
		</Section>
	);
}
