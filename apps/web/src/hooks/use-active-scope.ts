import { useQuery } from "@tanstack/react-query";
import { useMatch, useParams } from "@tanstack/react-router";
import type { ForgeId } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { resolveActiveScope } from "#/lib/active-scope";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { myOrgsQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";

export interface ActiveScope {
	org: OrgWithRole | null;
	repo: string | null;
	repoCandidate: string | null;
	repoForge: ForgeId | null;
	isPending: boolean;
}

export function useActiveScope(): ActiveScope {
	const params = useParams({ strict: false });
	const routeScope = useMatch({
		from: "/runs/$runId",
		shouldThrow: false,
		select: (match) => match.loaderData?.scope ?? null,
	});
	const { data: orgs, isPending: orgsPending } = useQuery(myOrgsQueryOptions());
	const { data: session, isPending: sessionPending } = useQuery(
		sessionInfoQueryOptions(),
	);

	const { org, repoCandidate } = resolveActiveScope({
		orgs,
		urlOrg: params.org,
		urlRepo: params.repo,
		routeScope,
		defaultOrgSlug: session?.defaultOrgSlug,
	});

	const {
		data: resolvedRepo,
		isPending: repoPending,
		isSuccess: repoResolved,
	} = useQuery({
		...orgRepoQueryOptions(org?.slug ?? "", repoCandidate ?? ""),
		enabled: Boolean(org && repoCandidate),
		retry: false,
	});

	return {
		org,
		repo: repoCandidate && repoResolved ? repoCandidate : null,
		repoCandidate,
		repoForge: resolvedRepo?.forge ?? null,
		isPending:
			orgsPending ||
			sessionPending ||
			(Boolean(org && repoCandidate) && repoPending),
	};
}
