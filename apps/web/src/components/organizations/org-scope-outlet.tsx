import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { rememberActiveOrg } from "#/lib/org.functions";

const route = getRouteApi("/$org");

export function OrgScopeOutlet() {
	const { org } = route.useParams();
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

	return <Outlet />;
}
