import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Outlet, useMatches } from "@tanstack/react-router";
import { useEffect } from "react";
import { RegionBlockedPage } from "#/components/organizations/region-blocked-page";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { rememberActiveOrg } from "#/lib/org.functions";
import { orgContextQueryOptions } from "#/lib/org.query";

const route = getRouteApi("/$org");

export function OrgScopeOutlet() {
	const { org } = route.useParams();
	const resolved = route.useRouteContext({ select: (context) => context.org });
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const permissions = (orgContext ?? resolved).permissions;
	const region = useMatches({
		select: (matches) =>
			matches.findLast((match) => match.staticData.region)?.staticData.region,
	});
	const queryClient = useQueryClient();
	const { data: session } = useQuery(sessionInfoQueryOptions());
	const signedIn = Boolean(session?.user);
	const remembered = session?.defaultOrgSlug ?? null;
	const { mutate: remember } = useMutation({
		mutationFn: (slug: string) => rememberActiveOrg({ data: { org: slug } }),
		onMutate: (slug) => {
			queryClient.setQueryData(sessionInfoQueryOptions().queryKey, (prev) =>
				prev ? { ...prev, defaultOrgSlug: slug } : prev,
			);
		},
	});

	useEffect(() => {
		if (signedIn && remembered !== org) {
			remember(org);
		}
	}, [signedIn, remembered, org, remember]);

	if (region && !permissions.includes(`${region}:read`)) {
		return <RegionBlockedPage region={region} />;
	}
	return <Outlet />;
}
