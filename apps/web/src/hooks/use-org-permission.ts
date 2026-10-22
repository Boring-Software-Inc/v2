import { useQuery } from "@tanstack/react-query";
import type { OrgPermission } from "@tripwire/auth/org-access";
import { orgContextQueryOptions } from "#/lib/org.query";

export function useOrgPermission(
	org: string,
	permission: OrgPermission,
): boolean {
	const { data } = useQuery({
		...orgContextQueryOptions(org),
		select: (context) => context.permissions.includes(permission),
	});
	return data ?? false;
}
