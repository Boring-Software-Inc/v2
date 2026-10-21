import { Link, useParams } from "@tanstack/react-router";
import { ArrowUpRight, Icon } from "#/components/glaze/icon";
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
		<div className="group/stat relative flex min-w-0 flex-col gap-1 p-3">
			{org && repo ? (
				<Link
					className="flex items-center gap-1 self-start type-label-sm text-text-2 decoration-line-strong underline-offset-3 transition-colors duration-(--dur-state) ease-out after:absolute after:inset-0 after:content-[''] group-hover/stat:text-text-1 group-hover/stat:underline group-focus-within/stat:text-text-1 group-focus-within/stat:underline"
					params={{ org, repo }}
					search={metric ? { metric } : {}}
					to="/$org/$repo/analytics"
				>
					{label}
					<Icon
						className="-translate-x-0.5 translate-y-0.5 opacity-0 transition-[opacity,translate] duration-(--dur-state) ease-out group-hover/stat:translate-0 group-hover/stat:opacity-100 group-focus-within/stat:translate-0 group-focus-within/stat:opacity-100 motion-reduce:transition-none"
						icon={ArrowUpRight}
						size={12}
					/>
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
						className="w-20 shrink-0 text-text-3 transition-colors duration-(--dur-state) ease-out group-hover/stat:text-text-1"
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
