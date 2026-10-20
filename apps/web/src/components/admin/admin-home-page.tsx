import { useQuery } from "@tanstack/react-query";
import { ItemRouterLink } from "#/components/common/router-links";
import { Billing, Icon, Members, Organization } from "#/components/glaze/icon";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { adminOverviewQueryOptions } from "#/lib/admin.query";

const SECTIONS = [
	{
		to: "/admin/users",
		icon: Members,
		title: "Users",
		description:
			"Review beta access. Approve or reject, one at a time or in bulk.",
	},
	{
		to: "/admin/orgs",
		icon: Organization,
		title: "Orgs",
		description: "Inspect orgs and members. Fix role state without psql.",
	},
	{
		to: "/admin/economics",
		icon: Billing,
		title: "Economics",
		description: "Unit cost, drift, credit burn-down and cost by org.",
	},
] as const;

export function AdminHomePage() {
	const { data } = useQuery(adminOverviewQueryOptions());

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Admin</h1>
						{data ? (
							<p className="type-body text-text-2">
								<span className="text-text-1 tabular-nums">
									{data.pendingUsers}
								</span>{" "}
								{data.pendingUsers === 1 ? "user is" : "users are"} waiting for
								access.{" "}
								<span className="text-text-1 tabular-nums">
									{data.approvedUsers}
								</span>{" "}
								approved, across{" "}
								<span className="text-text-1 tabular-nums">{data.orgs}</span>{" "}
								orgs and{" "}
								<span className="text-text-1 tabular-nums">{data.repos}</span>{" "}
								repos.
							</p>
						) : (
							<SkeletonText className="w-96 max-w-full" type="body" />
						)}
					</header>

					<ItemGroup aria-label="Admin sections">
						{SECTIONS.map((section) => (
							<Item key={section.to}>
								<ItemMedia variant="icon">
									<Icon icon={section.icon} />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>
										<ItemRouterLink to={section.to}>
											{section.title}
										</ItemRouterLink>
									</ItemTitle>
									<ItemDescription>{section.description}</ItemDescription>
								</ItemContent>
							</Item>
						))}
					</ItemGroup>
				</div>
			</div>
		</DashboardLayout>
	);
}
