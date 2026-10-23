import { notFound } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import type { OrgPermission } from "@tripwire/auth/org-access";
import type {
	OrgRequirement,
	OrgWithPermissions,
} from "@tripwire/auth/org-gate";
import { z } from "zod";

/**
 * Org-role function middlewares (§4) — the deny-by-default boundary for every
 * org-scoped server function, layered AFTER `accessGuardMiddleware` (beta
 * gate) in the chain:
 *
 *   createServerFn({ method })
 *     .middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:read")])
 *     .middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
 *     .middleware([accessGuardMiddleware, orgMemberMiddleware])   // org shell only
 *     .inputValidator((i: { org: string; ... }) => i)
 *     .handler(async ({ data, context }) => { context.org.id ... })
 *
 * The middleware reads `data.org` (the URL's org slug — every org-scoped fn
 * carries it), resolves membership and scopes FRESH from the DB via `resolveOrgAccess`, and
 * passes the resolved org (with the caller's role) to the handler as
 * `context.org`. EVERY denial — no session, no such org, non-member, or
 * member without the scope — is a `notFound()` (§8: existence is never disclosed,
 * the same posture as /admin). `notFound()`/`redirect()` are the ONLY throws
 * here: a raw `Response` can't cross the server-fn RPC boundary (Seroval can't
 * serialize it), which crashes SSR route loads. The structural boundary test
 * asserts the middleware in each fn's chain MATCHES its row in
 * server-fn-classification.ts.
 */

const ORG_SCOPED_INPUT = z.object({ org: z.string().min(1) });

async function resolveOrgFor(
	orgSlug: string,
	requirement: OrgRequirement,
): Promise<OrgWithPermissions> {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	const { getDb } = await import("#/lib/server/db");
	const db = getDb().db;
	const { withPermissions, resolveOrgAccess } = await import(
		"@tripwire/auth/org-gate"
	);
	if (!auth) {
		// Open-dev posture (no auth env): the gate stands open, but the org
		// must still EXIST — resolve it without a membership requirement.
		const { schema } = await import("@tripwire/db");
		const { eq } = await import("drizzle-orm");
		const rows = await db
			.select({
				id: schema.organization.id,
				slug: schema.organization.slug,
				name: schema.organization.name,
				isPersonal: schema.organization.isPersonal,
				avatarHue: schema.organization.avatarHue,
			})
			.from(schema.organization)
			.where(eq(schema.organization.slug, orgSlug))
			.limit(1);
		const row = rows[0];
		if (!row) {
			throw notFound();
		}
		return await withPermissions(db, { ...row, role: "admin" });
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const session = await auth.api.getSession({
		headers: getStartContext().request.headers,
	});
	if (!session) {
		throw notFound();
	}
	const result = await resolveOrgAccess(db, {
		userId: session.user.id,
		orgSlug,
		requirement,
	});
	if (!result.ok) {
		throw notFound();
	}
	return result.org;
}

function orgRequirementMiddleware(requirement: OrgRequirement) {
	return createMiddleware({ type: "function" }).server(
		async ({ next, data }) => {
			const input = ORG_SCOPED_INPUT.safeParse(data);
			if (!input.success) {
				throw notFound();
			}
			const org = await resolveOrgFor(input.data.org, requirement);
			return next({ context: { org } });
		},
	);
}

export function orgPermissionMiddleware(permission: OrgPermission) {
	return orgRequirementMiddleware({ kind: "permission", permission });
}

export const orgMemberMiddleware = orgRequirementMiddleware({
	kind: "membership",
});

export type OrgContext = { org: OrgWithPermissions };

/**
 * Verify a repo id belongs to the resolved org — the second half of the URL
 * contract for /:org/:repo-scoped fns. Throws the same 404 shape as the org
 * resolve: a repo outside the caller's org must be indistinguishable from a
 * repo that doesn't exist.
 */
export async function requireOrgRepoById(
	orgId: string,
	repoId: string,
): Promise<void> {
	const { getDb } = await import("#/lib/server/db");
	const { schema } = await import("@tripwire/db");
	const { and, eq } = await import("drizzle-orm");
	const rows = await getDb()
		.db.select({ id: schema.repos.id })
		.from(schema.repos)
		.where(and(eq(schema.repos.id, repoId), eq(schema.repos.orgId, orgId)))
		.limit(1);
	if (!rows[0]) {
		throw notFound();
	}
}

/**
 * Resolve /:org/:repo's repo segment (the repo NAME) within the org, or throw
 * the 404. The returned shape is the service's RepoLite.
 */
export async function resolveOrgRepo(orgId: string, repoName: string) {
	const { getDb } = await import("#/lib/server/db");
	const { orgServices } = await import("@tripwire/db");
	const repo = await orgServices.getOrgRepo(getDb().db, { orgId, repoName });
	if (!repo) {
		throw notFound();
	}
	return repo;
}
