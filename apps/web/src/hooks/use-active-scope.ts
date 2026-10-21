import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { OrgWithRole } from "@tripwire/db";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { myOrgsQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";

export interface ActiveScope {
	org: OrgWithRole | null;
	repo: string | null;
}

export function useActiveScope(): ActiveScope {
	const params = useParams({ strict: false });
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const { data: session } = useQuery(sessionInfoQueryOptions());

	const fromUrl = orgs?.find((candidate) => candidate.slug === params.org);
	const org =
		fromUrl ??
		orgs?.find((candidate) => candidate.slug === session?.defaultOrgSlug) ??
		orgs?.[0] ??
		null;

	const repoParam = fromUrl ? params.repo : undefined;
	const { isSuccess: repoResolved } = useQuery({
		...orgRepoQueryOptions(fromUrl?.slug ?? "", repoParam ?? ""),
		enabled: Boolean(fromUrl && repoParam),
		retry: false,
	});

	return { org, repo: repoParam && repoResolved ? repoParam : null };
}
