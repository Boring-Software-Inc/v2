import { queryOptions } from "@tanstack/react-query";
import type { Forge } from "@tripwire/contracts";
import { getOrgInstallUrl } from "#/lib/onboarding.functions";

/**
 * Install-flow query keys (§9). Org-scoped like #/lib/org.query — the slug
 * from the URL is IN the key, so switching orgs is a cache key change.
 */
export const onboardingQueryKeys = {
	all: ["onboarding"] as const,
	// The forge is IN the key: two forges mint different urls for the same org,
	// and sharing a key would serve one forge's install url for the other.
	installUrl: (org: string, forge: Forge) =>
		[...onboardingQueryKeys.all, "install-url", org, forge] as const,
};

/** ADMIN-only server fn — gate with `enabled` on the caller's role. */
export const orgInstallUrlQueryOptions = (
	org: string,
	forge: Forge = "github",
) =>
	queryOptions({
		queryKey: onboardingQueryKeys.installUrl(org, forge),
		queryFn: ({ signal }) => getOrgInstallUrl({ data: { org, forge }, signal }),
		staleTime: 5 * 60_000,
	});
