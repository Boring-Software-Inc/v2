import { staffUserRefSchema } from "@tripwire/contracts";
import { type Db, staffAuditServices, staffUserServices } from "@tripwire/db";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
	sessionMiddleware,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import type { OrgPermission } from "./org-access.ts";
import { isPlatformAdmin } from "./staff-gate.ts";

export const IMPERSONATION_SECONDS = 60 * 60;

export const IMPERSONATION_OPEN_PATHS: ReadonlySet<string> = new Set([
	"/get-session",
	"/sign-out",
	"/admin/stop-impersonating",
]);

export const IMPERSONATION_REFUSED =
	"You are viewing as someone else. Stop impersonating to change sign-in or account settings.";

export const IMPERSONATION_BLOCKED_PERMISSIONS: ReadonlySet<OrgPermission> =
	new Set<OrgPermission>([
		"members:manage",
		"settings:manage",
		"connections:manage",
	]);

export function impersonationBlocksPermission(
	permission: OrgPermission,
): boolean {
	return IMPERSONATION_BLOCKED_PERMISSIONS.has(permission);
}

export type ImpersonationRefusal =
	| "self"
	| "missing"
	| "staff"
	| "admin-role"
	| "banned";

export function impersonationRefusal(input: {
	actorId: string;
	targetId: string;
	target: {
		isPlatformAdmin: boolean;
		role: string | null;
		banned: boolean;
	} | null;
}): ImpersonationRefusal | null {
	if (input.actorId === input.targetId) {
		return "self";
	}
	if (!input.target) {
		return "missing";
	}
	if (input.target.isPlatformAdmin) {
		return "staff";
	}
	if (
		(input.target.role ?? "").split(",").some((role) => role.trim() === "admin")
	) {
		return "admin-role";
	}
	if (input.target.banned) {
		return "banned";
	}
	return null;
}

const REFUSAL_COPY: Record<ImpersonationRefusal, string> = {
	self: "You cannot impersonate yourself.",
	missing: "This user no longer exists.",
	staff: "Staff accounts cannot be impersonated.",
	"admin-role": "Admin accounts cannot be impersonated.",
	banned: "Unban this user before you impersonate them.",
};

export function impersonationRefusalMessage(refusal: ImpersonationRefusal) {
	return REFUSAL_COPY[refusal];
}

export function staffImpersonation(input: { db: Db }) {
	return {
		id: "tripwire-staff-impersonation",
		endpoints: {
			staffImpersonateUser: createAuthEndpoint(
				"/staff/impersonate-user",
				{
					method: "POST",
					body: staffUserRefSchema,
					use: [sessionMiddleware],
				},
				async (ctx) => {
					const actor = ctx.context.session;
					if (actor.session.impersonatedBy) {
						throw new APIError("FORBIDDEN", { message: IMPERSONATION_REFUSED });
					}
					if (!(await isPlatformAdmin(input.db, actor.user.id))) {
						throw new APIError("NOT_FOUND");
					}
					const target = await staffUserServices.getUserStaffBits(
						input.db,
						ctx.body.userId,
					);
					const refusal = impersonationRefusal({
						actorId: actor.user.id,
						targetId: ctx.body.userId,
						target,
					});
					if (refusal) {
						throw new APIError("FORBIDDEN", {
							message: impersonationRefusalMessage(refusal),
						});
					}
					const targetUser = await ctx.context.internalAdapter.findUserById(
						ctx.body.userId,
					);
					if (!targetUser) {
						throw new APIError("NOT_FOUND");
					}
					const expiresAt = new Date(Date.now() + IMPERSONATION_SECONDS * 1000);
					const created = await ctx.context.internalAdapter.createSession(
						targetUser.id,
						true,
						{ impersonatedBy: actor.user.id, expiresAt },
						true,
					);
					if (!created) {
						throw new APIError("INTERNAL_SERVER_ERROR");
					}
					const dontRememberMe = await ctx.getSignedCookie(
						ctx.context.authCookies.dontRememberToken.name,
						ctx.context.secret,
					);
					deleteSessionCookie(ctx);
					const adminCookie = ctx.context.createAuthCookie("admin_session");
					await ctx.setSignedCookie(
						adminCookie.name,
						`${actor.session.token}:${dontRememberMe || ""}`,
						ctx.context.secret,
						ctx.context.authCookies.sessionToken.attributes,
					);
					await setSessionCookie(
						ctx,
						{ session: created, user: targetUser },
						true,
					);
					await staffAuditServices.recordStaffAudit(input.db, {
						actorId: actor.user.id,
						targetUserId: targetUser.id,
						action: "impersonation.start",
						detail: { expiresAt: expiresAt.toISOString() },
					});
					return ctx.json({
						userId: targetUser.id,
						expiresAt: expiresAt.toISOString(),
					});
				},
			),
		},
		hooks: {
			before: [
				{
					matcher: (context) =>
						!IMPERSONATION_OPEN_PATHS.has(context.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const current = await getSessionFromCtx(ctx);
						if (current?.session.impersonatedBy) {
							throw new APIError("FORBIDDEN", {
								message: IMPERSONATION_REFUSED,
							});
						}
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
