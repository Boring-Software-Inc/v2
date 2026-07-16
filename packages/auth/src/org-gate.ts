import type { OrgRole } from "@tripwire/contracts";
import type { Db, OrgWithRole } from "@tripwire/db";
import { orgServices } from "@tripwire/db";

/**
 * Org role gate (§4) — the same architecture as `assertApproved`: read the
 * membership FRESH from the DB on every check (never from session or client
 * claims), return a denial the caller turns into its own response. Two roles:
 * member reads, admin additionally mutates. Deny-by-default: no membership
 * row ⇒ NOT_FOUND (a non-member must see 404, never 403 — org existence is
 * not disclosed, §8).
 */

export interface OrgDenial {
	/** NOT_FOUND covers both "no such org" and "not a member" — on purpose. */
	code: "NOT_FOUND" | "FORBIDDEN";
	message: string;
}

export type OrgGateResult =
	| { ok: true; org: OrgWithRole }
	| { ok: false; denial: OrgDenial };

/** Pure decision: does a held role afford the needed level? */
export function roleAffords(held: OrgRole, need: OrgRole): boolean {
	return need === "member" ? true : held === "admin";
}

/**
 * Resolve slug→org for a caller and require a role. `need: "member"` gates
 * reads; `need: "admin"` gates mutations. Admin-only moderation note: the
 * needed level for a surface is declared AT the server fn — loosening a
 * surface later (e.g. member-level moderation triage, the first candidate
 * for a per-org setting) is a one-site change of its `need`.
 */
export async function assertOrgRole(
	db: Db,
	input: { userId: string; orgSlug: string; need: OrgRole },
): Promise<OrgGateResult> {
	const org = await orgServices.getOrgForUser(db, {
		slug: input.orgSlug,
		userId: input.userId,
	});
	if (!org) {
		return {
			ok: false,
			denial: { code: "NOT_FOUND", message: "not found" },
		};
	}
	if (!roleAffords(org.role, input.need)) {
		return {
			ok: false,
			denial: {
				code: "FORBIDDEN",
				message: "this action needs an org admin",
			},
		};
	}
	return { ok: true, org };
}
