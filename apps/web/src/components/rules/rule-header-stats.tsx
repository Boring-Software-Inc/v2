import { Link, useParams } from "@tanstack/react-router";
import {
	Card,
	CardContent,
	CardFooter,
	CardMeta,
} from "#/components/glaze/ui/card";
import { Sparkline } from "#/components/glaze/ui/chart";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import type { RulesHeaderStats } from "#/lib/rules.functions";

export function RuleHeaderStats({
	stats,
}: {
	stats: RulesHeaderStats | undefined;
}) {
	return (
		<Card aria-label="Rule activity" role="group">
			<CardContent
				className="grid grid-cols-2 divide-x divide-line-faint"
				flush
			>
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
			<CardFooter>
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
	metric?: string;
}) {
	const { org, repo } = useParams({ strict: false });
	return (
		<div className="relative flex min-w-0 flex-col gap-1 p-3 hover:bg-hover-row">
			{org && repo ? (
				<Link
					className="type-label-sm text-text-2 after:absolute after:inset-0 after:content-['']"
					params={{ org, repo }}
					search={metric ? { metric } : {}}
					to="/$org/$repo/analytics"
				>
					{label}
				</Link>
			) : (
				<span className="type-label-sm text-text-2">{label}</span>
			)}
			<div className="flex items-center justify-between gap-3">
				{value === undefined ? (
					<SkeletonText className="w-10" type="heading" />
				) : (
					<span className="type-heading tabular-nums">{value}</span>
				)}
				{series?.some((v) => v > 0) ? (
					<Sparkline
						className="w-20 shrink-0 text-text-3"
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
