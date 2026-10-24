import { createServerFn } from "@tanstack/react-start";
import {
	type AccessStatus,
	type OrgRole,
	orgRoleSchema,
	staffReviewAccessInputSchema,
	staffSetRerunExemptInputSchema,
} from "@tripwire/contracts";
import type {
	StaffInstallationList,
	StaffOrgList,
	StaffOrgMemberRow,
	StaffOverview,
	StaffRepoList,
	StaffUserList,
} from "@tripwire/db";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	platformAdminMiddleware,
	sameOriginMiddleware,
} from "#/lib/server/staff-guard";

export type {
	StaffInstallationList,
	StaffOrgList,
	StaffOrgMemberRow,
	StaffOverview,
	StaffRepoList,
	StaffUserList,
};

/**
 * Platform staff surface (/admin). Every fn is class "staff": accessGuard +
 * platformAdminMiddleware, denial always 404. Reads are thin wrappers over
 * staffServices (paginated, clamped). Mutations are clients of the EXISTING
 * paths only: promoteUserAccess / rejectUserAccess (access.ts, the single home
 * for accessStatus writes) and updateMemberRoleForStaff (shares the plugin
 * hook's guard). The portal has no bypass powers over org invariants.
 */

/** The /admin layout's resolve: staff or the 404 the route shows. */
export const getAdminContext = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.handler(async ({ context }): Promise<{ staff: true; userId: string }> => {
		return { staff: true, userId: context.staff.userId };
	});

export const getAdminOverview = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.handler(async (): Promise<StaffOverview> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffServices } = await import("@tripwire/db");
		return staffServices.getStaffOverview(getDb().db);
	});

export const listAdminUsers = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator(
		(input: {
			status?: AccessStatus;
			search?: string;
			online?: boolean;
			limit?: number;
			offset?: number;
		}) => input,
	)
	.handler(async ({ data }): Promise<StaffUserList> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffServices } = await import("@tripwire/db");
		return staffServices.listUsersForStaff(getDb().db, data);
	});

export const listAdminOrgs = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator(
		(input: {
			search?: string;
			kind?: "personal" | "team";
			limit?: number;
			offset?: number;
		}) => input,
	)
	.handler(async ({ data }): Promise<StaffOrgList> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffServices } = await import("@tripwire/db");
		return staffServices.listOrgsForStaff(getDb().db, data);
	});

export const listAdminRepos = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator(
		(input: {
			status?: "protected" | "unprotected";
			search?: string;
			limit?: number;
			offset?: number;
		}) => input,
	)
	.handler(async ({ data }): Promise<StaffRepoList> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffServices } = await import("@tripwire/db");
		return staffServices.listReposForStaff(getDb().db, data);
	});

export const listAdminInstallations = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator((input: { limit?: number; offset?: number }) => input)
	.handler(async ({ data }): Promise<StaffInstallationList> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffServices } = await import("@tripwire/db");
		return staffServices.listInstallationsForStaff(getDb().db, data);
	});

export const listAdminOrgMembers = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator((input: { orgId: string }) => input)
	.handler(async ({ data }): Promise<StaffOrgMemberRow[]> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffServices } = await import("@tripwire/db");
		return staffServices.listOrgMembersForStaff(getDb().db, data.orgId);
	});

export interface ReviewAccessResult {
	/** Users whose status actually changed (already-there ids are skipped). */
	changed: number;
	total: number;
}

/**
 * Approve or reject beta access, single or bulk (the waitlist-clearing case).
 * Both directions write through access.ts — promoteUserAccess (the promotion
 * path invite redemption uses) and its mirror rejectUserAccess. Both stamp
 * accessReviewedAt/By with the acting admin and are idempotent, so re-running
 * a bulk approve is a no-op for already-approved users.
 */
export const reviewUserAccess = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator(
		(input: { userIds: string[]; decision: "approve" | "reject" }) =>
			staffReviewAccessInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<ReviewAccessResult> => {
		const userIds = [...new Set(data.userIds)].slice(0, 100);
		const { getDb } = await import("#/lib/server/db");
		const { accessServices, staffAuditServices } = await import("@tripwire/db");
		const reviewedBy = context.staff.userId;
		const action =
			data.decision === "approve" ? "access.approve" : "access.decline";
		let changed = 0;
		await getDb().db.transaction(async (tx) => {
			for (const userId of userIds) {
				const flipped =
					data.decision === "approve"
						? (
								await accessServices.promoteUserAccess(tx, {
									userId,
									reviewedBy,
								})
							).promoted
						: (
								await accessServices.rejectUserAccess(tx, {
									userId,
									reviewedBy,
								})
							).rejected;
				if (flipped) {
					changed++;
					await staffAuditServices.recordStaffAudit(tx, {
						actorId: reviewedBy,
						targetUserId: userId,
						action,
					});
				}
			}
		});
		return { changed, total: userIds.length };
	});

/**
 * Change a member's org role from the portal. The plugin endpoint refuses
 * non-member callers, so this routes through updateMemberRoleForStaff — the
 * SAME `assertRoleChangeAllowed` guard the plugin hook runs, so the last-admin
 * and personal-org invariants apply identically.
 */
const memberRoleInput = z.object({
	memberId: z.string().min(1).max(200),
	role: orgRoleSchema,
});

export const adminUpdateOrgMemberRole = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { memberId: string; role: OrgRole }) =>
		memberRoleInput.parse(input),
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ ok: true } | { ok: false; error: string }> => {
			const { getDb } = await import("#/lib/server/db");
			const { orgServices, staffAuditServices } = await import("@tripwire/db");
			const result = await orgServices.updateMemberRoleForStaff(getDb().db, {
				memberId: data.memberId,
				role: data.role,
			});
			if (result.ok) {
				await staffAuditServices.recordStaffAudit(getDb().db, {
					actorId: context.staff.userId,
					targetUserId: null,
					action: "org.member_role",
					detail: { memberId: data.memberId, role: data.role },
				});
			}
			return result;
		},
	);

/**
 * Toggle a user's re-run cooldown exemption (staff flag). Duration stays
 * global via `RERUN_COOLDOWN_SECONDS`; this only opts an account out.
 */
export const setUserRerunCooldownExempt = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string; exempt: boolean }) =>
		staffSetRerunExemptInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<{ changed: boolean }> => {
		const { getDb } = await import("#/lib/server/db");
		const { staffAuditServices, staffServices } = await import("@tripwire/db");
		const result = await staffServices.setRerunCooldownExempt(getDb().db, data);
		if (result.changed) {
			await staffAuditServices.recordStaffAudit(getDb().db, {
				actorId: context.staff.userId,
				targetUserId: data.userId,
				action: "account.rerun_cooldown",
				detail: { exempt: data.exempt },
			});
		}
		return result;
	});
