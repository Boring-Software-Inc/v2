import type { OrgWithRole } from "@tripwire/db";
import type { RunView } from "#/lib/runs.functions";

export interface RouteScope {
	org: string;
	repo: string | null;
}

export interface ActiveScopeInput {
	orgs: readonly OrgWithRole[] | undefined;
	urlOrg: string | undefined;
	urlRepo: string | undefined;
	routeScope: RouteScope | null | undefined;
	defaultOrgSlug: string | null | undefined;
}

export interface ActiveScopeResolution {
	org: OrgWithRole | null;
	repoCandidate: string | null;
}

export function resolveActiveScope({
	orgs,
	urlOrg,
	urlRepo,
	routeScope,
	defaultOrgSlug,
}: ActiveScopeInput): ActiveScopeResolution {
	const member = (slug: string | null | undefined) =>
		slug ? orgs?.find((candidate) => candidate.slug === slug) : undefined;

	const fromUrl = member(urlOrg);
	if (fromUrl) {
		return { org: fromUrl, repoCandidate: urlRepo ?? null };
	}
	const fromRoute = member(routeScope?.org);
	if (fromRoute) {
		return { org: fromRoute, repoCandidate: routeScope?.repo ?? null };
	}
	return {
		org: member(defaultOrgSlug) ?? orgs?.[0] ?? null,
		repoCandidate: null,
	};
}

export function runRouteScope(
	run: Pick<RunView, "orgSlug" | "repoName"> | null | undefined,
): RouteScope | null {
	if (!run?.orgSlug) {
		return null;
	}
	return { org: run.orgSlug, repo: run.repoName };
}
