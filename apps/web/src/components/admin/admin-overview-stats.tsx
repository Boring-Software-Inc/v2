import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "#/design-system/ui/item";
import { SkeletonText } from "#/design-system/ui/skeleton";
import { DataValue } from "#/design-system/ui/typography";
import type { StaffOverview } from "#/lib/admin.functions";

interface OverviewRow {
	key: string;
	label: string;
	value: number | undefined;
	detail?: string;
	link?: ReactNode;
}

export function AdminOverviewStats({
	overview,
}: {
	overview: StaffOverview | undefined;
}) {
	const rows: OverviewRow[] = [
		{
			key: "online",
			label: "Online now",
			value: overview?.onlineUsers,
			link: (
				<Link search={{ online: true }} to="/admin/users">
					Online now
				</Link>
			),
		},
		{
			key: "users",
			label: "Users",
			value: overview?.totalUsers,
			link: (
				<Link search={{}} to="/admin/users">
					Users
				</Link>
			),
		},
		{
			key: "protected-repos",
			label: "Protected repos",
			value: overview?.protectedRepos,
			detail: overview ? `of ${overview.repos}` : undefined,
			link: (
				<Link search={{ status: "protected" }} to="/admin/repos">
					Protected repos
				</Link>
			),
		},
		{
			key: "installations",
			label: "Installations",
			value: overview?.installations,
			link: <Link to="/admin/installations">Installations</Link>,
		},
		{
			key: "orgs",
			label: "Team orgs",
			value: overview?.teamOrgs,
			detail: overview ? `${overview.personalOrgs} personal` : undefined,
			link: <Link to="/admin/orgs">Team orgs</Link>,
		},
		{
			key: "blocked",
			label: "Blocked in the last day",
			value: overview?.blockedChangeRequestsLastDay,
		},
	];

	return (
		<ItemGroup aria-label="Product at a glance">
			{rows.map((row) => (
				<Item key={row.key}>
					<ItemContent>
						<ItemTitle>
							{row.link ? (
								<span data-layout-role="admin-summary-link">{row.link}</span>
							) : (
								row.label
							)}
						</ItemTitle>
					</ItemContent>
					<div data-layout-role="admin-summary-value">
						{row.value === undefined ? (
							<SkeletonText data-layout-size="summary-value" type="label" />
						) : (
							<>
								<DataValue>{row.value}</DataValue>
								{row.detail ? <span>{row.detail}</span> : null}
							</>
						)}
					</div>
				</Item>
			))}
		</ItemGroup>
	);
}
