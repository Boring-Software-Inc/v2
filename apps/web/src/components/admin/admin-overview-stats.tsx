import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowUpRight, Icon } from "#/components/glaze/icon";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import type { StaffOverview } from "#/lib/admin.functions";

const STAT_LINK_CLASS =
	"flex items-center gap-1 self-start type-label-sm text-text-2 decoration-line-strong underline-offset-3 transition-colors duration-(--dur-state) ease-out after:absolute after:inset-0 after:content-[''] group-hover/stat:text-text-1 group-hover/stat:underline group-focus-within/stat:text-text-1 group-focus-within/stat:underline";

export function AdminOverviewStats({
	overview,
}: {
	overview: StaffOverview | undefined;
}) {
	return (
		<Card aria-label="Product at a glance" role="group">
			<CardContent className="overflow-hidden" flush>
				<dl className="-me-px -mb-px grid grid-cols-2 md:grid-cols-3">
					<StatCell
						label={
							<Link
								className={STAT_LINK_CLASS}
								search={{ online: true }}
								to="/admin/users"
							>
								Online now
								<StatArrow />
							</Link>
						}
						value={overview?.onlineUsers}
					/>
					<StatCell
						label={
							<Link className={STAT_LINK_CLASS} search={{}} to="/admin/users">
								Users
								<StatArrow />
							</Link>
						}
						value={overview?.totalUsers}
					/>
					<StatCell
						detail={overview ? `of ${overview.repos}` : undefined}
						label={
							<Link
								className={STAT_LINK_CLASS}
								search={{ status: "protected" }}
								to="/admin/repos"
							>
								Protected repos
								<StatArrow />
							</Link>
						}
						value={overview?.protectedRepos}
					/>
					<StatCell
						label={
							<Link className={STAT_LINK_CLASS} to="/admin/installations">
								Installations
								<StatArrow />
							</Link>
						}
						value={overview?.installations}
					/>
					<StatCell
						detail={
							overview ? `team, ${overview.personalOrgs} personal` : undefined
						}
						label={
							<Link className={STAT_LINK_CLASS} to="/admin/orgs">
								Orgs
								<StatArrow />
							</Link>
						}
						value={overview?.teamOrgs}
					/>
					<StatCell
						label={
							<span className="type-label-sm text-text-2">
								Blocked in the last day
							</span>
						}
						value={overview?.blockedChangeRequestsLastDay}
					/>
				</dl>
			</CardContent>
		</Card>
	);
}

function StatArrow() {
	return (
		<Icon
			className="-translate-x-0.5 translate-y-0.5 opacity-0 transition-[opacity,translate] duration-(--dur-state) ease-out group-hover/stat:translate-0 group-hover/stat:opacity-100 group-focus-within/stat:translate-0 group-focus-within/stat:opacity-100 motion-reduce:transition-none"
			icon={ArrowUpRight}
			size={12}
		/>
	);
}

function StatCell({
	label,
	value,
	detail,
}: {
	label: ReactNode;
	value: number | undefined;
	detail?: string;
}) {
	return (
		<div className="group/stat relative flex min-w-0 flex-col gap-1 border-line-faint border-e border-b p-3">
			<dt className="flex">{label}</dt>
			<dd className="flex min-w-0 items-baseline gap-1.5">
				{value === undefined ? (
					<SkeletonText className="w-10" type="heading" />
				) : (
					<>
						<span className="type-heading tabular-nums">{value}</span>
						{detail ? (
							<span className="truncate type-body-sm text-text-2 tabular-nums">
								{detail}
							</span>
						) : null}
					</>
				)}
			</dd>
		</div>
	);
}
