import {
	createFileRoute,
	notFound,
	Outlet,
	stripSearchParams,
} from "@tanstack/react-router";
import { NotFound } from "#/components/not-found";
import { orgContextQueryOptions } from "#/lib/org.query";
import { ORG_SEARCH_DEFAULTS, orgSearchSchema } from "#/lib/org-search";

/**
 * §8 — the URL is the source of truth for org scope. This layout resolves
 * the slug to an org + the caller's role BEFORE render; a non-member (or a
 * missing org) is a 404, never a 403 — org existence is not disclosed.
 */
export const Route = createFileRoute("/$org")({
	validateSearch: orgSearchSchema,
	search: { middlewares: [stripSearchParams(ORG_SEARCH_DEFAULTS)] },
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
	notFoundComponent: NotFound,
	// Pages own their DashboardLayout wrap (repo convention) — the layout
	// route only resolves scope.
	component: () => <Outlet />,
});
