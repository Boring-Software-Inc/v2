import { Link, useParams } from "@tanstack/react-router";
import { Card, CardContent, CardFooter, CardMeta } from "@tripwire/ui/card";
import { ArrowUpRight, Icon } from "@tripwire/ui/icon";
import { SkeletonText } from "@tripwire/ui/skeleton";
import { Sparkline } from "#/components/common/chart";
import type { AnalyticsMetricKey } from "#/lib/repo-search";
import type { RulesHeaderStats } from "#/lib/rules.functions";

export function RuleHeaderStats({
	stats,
}: {
	stats: RulesHeaderStats | undefined;
}) {
	return (
		<Card
			aria-label="Rule activity"
			data-layout-role="rule-stats-frame"
			role="group"
		>
			<CardContent data-layout-role="rule-header-stats" flush>
				<StatCell
					label="Matches"
					series={stats?.matches24h.series}
					value={stats?.matches24h.value}
				/>
				<StatCell
					label="Actions taken"
					metric="blocked"
					series={stats?.actioned24h.series}
					value={stats?.actioned24h.value}
				/>
			</CardContent>
			<CardFooter data-layout-role="rule-stats-footer">
				<CardMeta>Last 24 hours</CardMeta>
			</CardFooter>
		</Card>
	);
}

function StatCell({
	label,
	value,
	series,
	metric,
}: {
	label: string;
	value: number | undefined;
	series: number[] | undefined;
	metric?: AnalyticsMetricKey;
}) {
	const { org, repo } = useParams({ strict: false });
	return (
		<div className="group/stat relative flex min-w-0 flex-col composition-gap-small rule-stat-inset">
			{org && repo ? (
				<Link
					className="flex items-center composition-gap-small self-start content-label-small tone-content-secondary decoration-line-strong underline-offset-3 transition-colors duration-(--dur-state) ease-out rule-stat-link group-hover/stat:tone-content-primary group-hover/stat:underline group-focus-within/stat:tone-content-primary group-focus-within/stat:underline"
					params={{ org, repo }}
					search={metric ? { metric } : {}}
					to="/$org/$repo/analytics"
				>
					{label}
					<span className="-translate-x-0.5 translate-y-0.5 opacity-0 transition-opacity-translate duration-(--dur-state) ease-out group-hover/stat:translate-0 group-hover/stat:opacity-100 group-focus-within/stat:translate-0 group-focus-within/stat:opacity-100 motion-reduce:transition-none">
						<Icon icon={ArrowUpRight} size={12} />
					</span>
				</Link>
			) : (
				<span className="content-label-small tone-content-secondary">
					{label}
				</span>
			)}
			<div className="flex items-center justify-between composition-gap-section">
				{value === undefined ? (
					<span data-skeleton-line="" aria-hidden className="w-10">
						<SkeletonText type="heading" />
					</span>
				) : (
					<span className="type-heading tabular-nums">{value}</span>
				)}
				{series?.some((v) => v > 0) ? (
					<Sparkline
						data-layout-role="rule-activity-trend"
						data={series}
						end={false}
						label={`${label} per hour, last 24 hours`}
						size="sm"
					/>
				) : null}
			</div>
		</div>
	);
}
