import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveScope } from "#/hooks/use-active-scope";
import { useOrgPermission } from "#/hooks/use-org-permission";
import {
	getSharedBlocklistPilot,
	setSharedBlocklistPilot,
} from "#/lib/shared-blocklist.functions";

export function useSharedBlocklistPilot() {
	const scope = useActiveScope();
	const org = scope.org?.slug ?? "";
	const repo = scope.repo ?? "";
	const canManage = useOrgPermission(org, "rules:manage");
	const queryClient = useQueryClient();
	const queryKey = ["shared-blocklist-pilot", org, repo] as const;
	const pilot = useQuery({
		queryKey,
		queryFn: () => getSharedBlocklistPilot({ data: { org, repo } }),
		enabled: Boolean(org && repo && canManage),
		retry: false,
	});
	const save = useMutation({
		mutationFn: (enabled: boolean) =>
			setSharedBlocklistPilot({ data: { org, repo, enabled } }),
		onSuccess: (result) => queryClient.setQueryData(queryKey, result),
	});
	return { org, repo, pilot: canManage ? pilot.data : null, save };
}
