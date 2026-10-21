import type { ReactNode } from "react";
import { CardRouterLink } from "#/components/common/router-links";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import { Sparkline } from "#/components/glaze/ui/chart";
import { SkeletonText } from "#/components/glaze/ui/skeleton";

export interface StatCardProps {
	label: string;
	value: number | undefined;
	detail?: ReactNode;
	series?: number[];
	link?: { org: string; repo: string; metric?: string };
}

export function StatCard({
	label,
	value,
	detail,
	series,
	link,
}: StatCardProps) {
	return (
		<Card className="relative">
			<CardHeader>
				<CardTitle className="type-label-sm text-text-2">
					{link ? (
						<CardRouterLink
							params={{ org: link.org, repo: link.repo }}
							search={link.metric ? { metric: link.metric } : {}}
							to="/$org/$repo/analytics"
						>
							{label}
						</CardRouterLink>
					) : (
						label
					)}
				</CardTitle>
			</CardHeader>
			<CardContent className="gap-0.5">
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
				<span className="truncate type-caption text-text-2">
					{detail ?? "\u00a0"}
				</span>
			</CardContent>
		</Card>
	);
}
