import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { OrgNotFound } from "#/components/organizations/org-not-found";
import { parseOrgSettingsTab } from "#/components/organizations/org-settings-tab";
import { orgContextQueryOptions } from "#/lib/org.query";

/**
 * §8 — the URL is the source of truth for org scope. This layout resolves
 * the slug to an org + the caller's role BEFORE render; a non-member (or a
 * missing org) is a 404, never a 403 — org existence is not disclosed.
 */
export const Route = createFileRoute("/$org")({
	// The org settings dialog is URL-driven (`?settings=members|settings|billing`)
	// and can open over any org page, so the param validates at the org root.
	validateSearch: (search: Record<string, unknown>) => {
		const settings = parseOrgSettingsTab(search.settings);
		return settings ? { settings } : {};
	},
	beforeLoad: async ({ params, context }) => {
		try {
			const org = await context.queryClient.ensureQueryData(
				orgContextQueryOptions(params.org),
			);
			return { org };
		} catch {
			throw notFound();
		}
	},
	notFoundComponent: OrgNotFound,
	// Pages own their DashboardLayout wrap (repo convention) — the layout
	// route only resolves scope.
	component: () => <Outlet />,
});
