import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { adminOverviewQueryOptions } from "#/lib/admin.query";

/** /admin — counts and links. A tool, not a dashboard. */
export function AdminHomePage() {
	const { data } = useQuery(adminOverviewQueryOptions());

	const stats = [
		{ key: "pending", label: "pending users", value: data?.pendingUsers },
		{ key: "approved", label: "approved users", value: data?.approvedUsers },
		{ key: "orgs", label: "orgs", value: data?.orgs },
		{ key: "repos", label: "repos", value: data?.repos },
	];

	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<header className="mb-6">
					<h1 className="font-semibold text-2xl tracking-tight">Admin</h1>
					<p className="text-muted-foreground text-sm">
						platform administration. staff only.
					</p>
				</header>

				<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
					{stats.map((stat) => (
						<div className="rounded-xl border bg-card px-4 py-3" key={stat.key}>
							<p className="text-muted-foreground text-xs">{stat.label}</p>
							<p className="font-semibold text-2xl tabular-nums tracking-tight">
								{stat.value ?? "–"}
							</p>
						</div>
					))}
				</div>

				<div className="mt-6 flex flex-col gap-3">
					<Link
						className="rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-surface-1"
						to="/admin/users"
					>
						<p className="font-medium text-sm">users</p>
						<p className="text-muted-foreground text-xs">
							review beta access. approve or reject, single or in bulk.
						</p>
					</Link>
					<Link
						className="rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-surface-1"
						to="/admin/orgs"
					>
						<p className="font-medium text-sm">orgs</p>
						<p className="text-muted-foreground text-xs">
							inspect orgs and members. fix role state without psql.
						</p>
					</Link>
					<Link
						className="rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-surface-1"
						to="/admin/economics"
					>
						<p className="font-medium text-sm">economics</p>
						<p className="text-muted-foreground text-xs">
							unit cost, drift, credit burn-down, and cost by org.
						</p>
					</Link>
				</div>
			</div>
		</DashboardLayout>
	);
}
