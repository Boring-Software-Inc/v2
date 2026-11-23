import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { RepoLayout } from "#/components/layouts/repo-layout";
import { NotFound } from "#/components/not-found";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { repoRouteKey } from "#/lib/repo-route";

/** /:org/:repo — resolve canonical or legacy repo identity, 404 otherwise. */
export const Route = createFileRoute("/$org/$repo")({
	beforeLoad: async ({ params, context, location }) => {
		const repo = await context.queryClient
			.ensureQueryData(orgRepoQueryOptions(params.org, params.repo))
			.catch(() => {
				throw notFound();
			});
		const canonicalRepo = repoRouteKey(repo);
		if (params.repo !== canonicalRepo) {
			const tail = location.pathname.split("/").slice(3);
			const pathname = ["", params.org, canonicalRepo, ...tail].join("/");
			throw redirect({
				href: `${pathname}${location.searchStr}${location.hash}`,
				replace: true,
			});
		}
		return { repo };
	},
	notFoundComponent: NotFound,
	component: RepoLayout,
});
