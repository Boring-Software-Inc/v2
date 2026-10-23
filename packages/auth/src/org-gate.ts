import type { OrgRole } from "@tripwire/contracts";
import type { Db, OrgWithRole } from "@tripwire/db";
import { orgServices } from "@tripwire/db";
import {
	isBuiltInOrgRole,
	type OrgPermission,
	resolveOrgPermissions,
	roleNames,
} from "./org-access.ts";

/**
 * Org role gate (§4) — the same architecture as `assertApproved`: read the
 * membership FRESH from the DB on every check (never from session or client
 * claims), return a denial the caller turns into its own response.
 * Deny-by-default: no membership row ⇒ NOT_FOUND (a non-member must see 404,
 * never 403 — org existence is not disclosed, §8).
 */

export interface OrgDenial {
	/** NOT_FOUND covers both "no such org" and "not a member" — on purpose. */
	code: "NOT_FOUND" | "FORBIDDEN";
	message: string;
}

export type OrgWithPermissions = OrgWithRole & {
	permissions: OrgPermission[];
};

export type OrgGateResult =
	| { ok: true; org: OrgWithPermissions }
	| { ok: false; denial: OrgDenial };

export type OrgRequirement =
	| { kind: "membership" }
	| { kind: "role"; need: OrgRole }
	| { kind: "permission"; permission: OrgPermission };

export async function withPermissions(
	db: Db,
	org: OrgWithRole,
): Promise<OrgWithPermissions> {
	const custom = roleNames(org.role).filter((name) => !isBuiltInOrgRole(name));
	const rows = await orgServices.getOrgRoles(db, org.id, custom);
	return { ...org, permissions: resolveOrgPermissions(org.role, rows) };
}

export async function memberPermissions(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<OrgPermission[] | null> {
	const role = await orgServices.getMemberRole(db, input);
	if (role === null) {
		return null;
	}
	const custom = roleNames(role).filter((name) => !isBuiltInOrgRole(name));
	const rows = await orgServices.getOrgRoles(db, input.orgId, custom);
	return resolveOrgPermissions(role, rows);
}

export async function reposWithPermission(
	db: Db,
	userId: string,
	permission: OrgPermission,
): Promise<string[]> {
	const orgs = await orgServices.listUserOrgs(db, userId);
	const names: string[] = [];
	for (const org of orgs) {
		const scoped = await withPermissions(db, org);
		if (scoped.permissions.includes(permission)) {
			const repos = await orgServices.listOrgRepos(db, org.id);
			names.push(...repos.map((repo) => repo.fullName));
		}
	}
	return names;
}

export function roleAffords(held: string, need: OrgRole): boolean {
	const names = roleNames(held);
	if (names.includes("admin")) {
		return true;
	}
	return need === "member" && names.includes("member");
}

export function requirementMet(
	org: OrgWithPermissions,
	requirement: OrgRequirement,
): boolean {
	switch (requirement.kind) {
		case "membership":
			return true;
		case "role":
			return roleAffords(org.role, requirement.need);
		case "permission":
			return org.permissions.includes(requirement.permission);
	}
}

export async function resolveOrgAccess(
	db: Db,
	input: { userId: string; orgSlug: string; requirement: OrgRequirement },
): Promise<OrgGateResult> {
	const found = await orgServices.getOrgForUser(db, {
		slug: input.orgSlug,
		userId: input.userId,
	});
	if (!found) {
		return {
			ok: false,
			denial: { code: "NOT_FOUND", message: "not found" },
		};
	}
	const org = await withPermissions(db, found);
	if (!requirementMet(org, input.requirement)) {
		return {
			ok: false,
			denial: {
				code: "FORBIDDEN",
				message: "this action needs access the caller lacks",
			},
		};
	}
	return { ok: true, org };
}

export async function assertOrgRole(
	db: Db,
	input: { userId: string; orgSlug: string; need: OrgRole },
): Promise<OrgGateResult> {
	return await resolveOrgAccess(db, {
		userId: input.userId,
		orgSlug: input.orgSlug,
		requirement: { kind: "role", need: input.need },
	});
}

export async function assertOrgPermission(
	db: Db,
	input: { userId: string; orgSlug: string; permission: OrgPermission },
): Promise<OrgGateResult> {
	return await resolveOrgAccess(db, {
		userId: input.userId,
		orgSlug: input.orgSlug,
		requirement: { kind: "permission", permission: input.permission },
	});
}
