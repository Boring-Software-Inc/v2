import { useQuery } from "@tanstack/react-query";
import { EntityCard } from "#/components/common/entity-card";
import { CardRouterLink } from "#/components/common/router-links";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { adminOverviewQueryOptions } from "#/lib/admin.query";

const SECTIONS = [
	{
		to: "/admin/users",
		title: "Users",
		description:
			"Review beta access. Approve or decline, one at a time or in bulk.",
	},
	{
		to: "/admin/orgs",
		title: "Orgs",
		description: "See every org and its members, and change member roles.",
	},
	{
		to: "/admin/economics",
		title: "Economics",
		description:
			"Cost per run, drift from invoices, remaining credit, and cost by org.",
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

					<ul aria-label="Admin sections" className="flex flex-col gap-3">
						{SECTIONS.map((section) => (
							<li key={section.to}>
								<EntityCard
									description={section.description}
									title={
										<CardRouterLink to={section.to}>
											{section.title}
										</CardRouterLink>
									}
								/>
							</li>
						))}
					</ul>
				</div>
			</div>
		</DashboardLayout>
	);
}
