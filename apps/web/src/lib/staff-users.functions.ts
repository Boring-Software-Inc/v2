import { createServerFn } from "@tanstack/react-start";
import {
	type FlagOverrideChoice,
	type FlagSource,
	type FlagSyncStatus,
	recordAnonIdInputSchema,
	type StaffAuditAction,
	type StaffAuditDetail,
	staffBanInputSchema,
	staffDeleteUserInputSchema,
	staffRetryFlagSyncInputSchema,
	staffRevokeAgentInputSchema,
	staffRevokeSessionInputSchema,
	staffSetFlagOverrideInputSchema,
	staffSetPlatformAdminInputSchema,
	staffSetTimezoneInputSchema,
	staffUserRefSchema,
} from "@tripwire/contracts";
import type {
	ConnectedAgent,
	FlagOverrideHistoryEntry,
	OrgWithRole,
	StaffAuditEntry,
	StaffContributorRun,
	StaffForgeIdentity,
	StaffModerationDecision,
	StaffUserDetail,
	StaffUserSession,
} from "@tripwire/db";
import type {
	DatabuddyProfileSummary,
	DatabuddySessionSummary,
} from "#/lib/databuddy-activity";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	platformAdminMiddleware,
	sameOriginMiddleware,
} from "#/lib/server/staff-guard";

export type ImpersonationAvailability =
	| { ok: true }
	| { ok: false; reason: string };

export interface AdminUserView {
	user: StaffUserDetail;
	viewerId: string;
	impersonation: ImpersonationAvailability;
	sessions: StaffUserSession[];
	agents: ConnectedAgent[];
	forgeIdentities: StaffForgeIdentity[];
	orgs: OrgWithRole[];
	decisions: { items: StaffModerationDecision[]; total: number };
	contributor: { runs: StaffContributorRun[]; total: number };
	audit: StaffAuditEntry[];
}

export interface AdminUserFlagRow {
	key: string;
	name: string | null;
	inDatabuddy: boolean | null;
	evaluated: { enabled: boolean; source: FlagSource } | null;
	override: {
		choice: FlagOverrideChoice;
		syncStatus: FlagSyncStatus;
		syncError: string | null;
		syncedAt: Date | null;
	} | null;
}

export interface AdminUserFlagsView {
	connected: boolean;
	listError: string | null;
	rows: AdminUserFlagRow[];
	history: FlagOverrideHistoryEntry[];
}

export type AdminUserActivityView =
	| { connected: false }
	| { connected: true; error: string }
	| {
			connected: true;
			error: null;
			profile: DatabuddyProfileSummary | null;
			sessions: DatabuddySessionSummary[];
	  };

export type StaffActionResult = { ok: true } | { ok: false; error: string };

async function staffDb() {
	const { getDb } = await import("#/lib/server/db");
	return getDb().db;
}

async function audit(input: {
	actorId: string;
	targetUserId: string;
	action: StaffAuditAction;
	detail?: StaffAuditDetail;
}): Promise<void> {
	const { staffAuditServices } = await import("@tripwire/db");
	await staffAuditServices.recordStaffAudit(await staffDb(), input);
}

async function confirmTextFor(userId: string): Promise<string | null> {
	const { staffUserServices } = await import("@tripwire/db");
	const detail = await staffUserServices.getStaffUserDetail(
		await staffDb(),
		userId,
	);
	if (!detail) {
		return null;
	}
	return detail.login ?? detail.name;
}

export const getAdminUser = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator((input: { userId: string }) =>
		staffUserRefSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<AdminUserView | null> => {
		const db = await staffDb();
		const {
			agentServices,
			orgServices,
			staffAuditServices,
			staffUserServices,
		} = await import("@tripwire/db");
		const user = await staffUserServices.getStaffUserDetail(db, data.userId);
		if (!user) {
			return null;
		}
		const { impersonationRefusal, impersonationRefusalMessage } = await import(
			"@tripwire/auth/staff-impersonation"
		);
		const logins = await staffUserServices.getUserLogins(db, data.userId);
		const [
			sessions,
			agents,
			forgeIdentities,
			orgs,
			decisions,
			contributor,
			log,
		] = await Promise.all([
			staffUserServices.listUserSessions(db, data.userId),
			agentServices.listConnectedAgents(db, data.userId),
			staffUserServices.listUserForgeIdentities(db, data.userId),
			orgServices.listUserOrgs(db, data.userId),
			staffUserServices.listModerationDecisionsBy(db, data.userId),
			staffUserServices.listContributorRuns(db, logins),
			staffAuditServices.listStaffAuditForUser(db, data.userId, 20),
		]);
		const refusal = impersonationRefusal({
			actorId: context.staff.userId,
			targetId: user.id,
			target: user,
		});
		return {
			user,
			viewerId: context.staff.userId,
			impersonation: refusal
				? { ok: false, reason: impersonationRefusalMessage(refusal) }
				: { ok: true },
			sessions,
			agents,
			forgeIdentities,
			orgs,
			decisions,
			contributor,
			audit: log,
		};
	});

export const getAdminUserFlags = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator((input: { userId: string }) =>
		staffUserRefSchema.parse(input),
	)
	.handler(async ({ data }): Promise<AdminUserFlagsView> => {
		const db = await staffDb();
		const { flagOverrideServices, staffUserServices } = await import(
			"@tripwire/db"
		);
		const { FLAGS } = await import("@tripwire/auth/databuddy");
		const { getDatabuddyApi, getFlagEvaluator } = await import(
			"#/lib/server/staff-users"
		);
		const { getErrorMessage } = await import("@tripwire/utils");
		const user = await staffUserServices.getStaffUserDetail(db, data.userId);
		const api = getDatabuddyApi();
		let listError: string | null = null;
		const remote = new Map<string, string | null>();
		if (api) {
			try {
				for (const flag of await api.listFlags()) {
					if (flag.status !== "archived") {
						remote.set(flag.key, flag.name ?? null);
					}
				}
			} catch (error) {
				listError = getErrorMessage(error);
			}
		}
		const [overrides, history] = await Promise.all([
			flagOverrideServices.listUserFlagOverrides(db, data.userId),
			flagOverrideServices.listFlagOverrideHistory(db, data.userId),
		]);
		const keys = [
			...new Set([
				...Object.values(FLAGS),
				...remote.keys(),
				...overrides.map((o) => o.flagKey),
			]),
		].sort();
		const evaluate = await getFlagEvaluator();
		const evaluated = user
			? await evaluate(keys, { userId: user.id, email: user.email })
			: [];
		const byKey = new Map(evaluated.map((flag) => [flag.key, flag]));
		const overrideByKey = new Map(overrides.map((o) => [o.flagKey, o]));
		const connected = api !== null;
		return {
			connected,
			listError,
			history,
			rows: keys.map((key) => {
				const value = byKey.get(key);
				const override = overrideByKey.get(key);
				return {
					key,
					name: remote.get(key) ?? null,
					inDatabuddy: connected && listError === null ? remote.has(key) : null,
					evaluated:
						value && value.reason !== null
							? { enabled: value.enabled, source: value.source }
							: null,
					override: override
						? {
								choice: override.choice,
								syncStatus: override.syncStatus,
								syncError: override.syncError,
								syncedAt: override.syncedAt,
							}
						: null,
				};
			}),
		};
	});

export const getAdminUserActivity = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.inputValidator((input: { userId: string }) =>
		staffUserRefSchema.parse(input),
	)
	.handler(async ({ data }): Promise<AdminUserActivityView> => {
		const { getDatabuddyApi } = await import("#/lib/server/staff-users");
		const api = getDatabuddyApi();
		if (!api) {
			return { connected: false };
		}
		const { summarizeProfile, summarizeSessions } = await import(
			"#/lib/databuddy-activity"
		);
		const { getErrorMessage } = await import("@tripwire/utils");
		try {
			const activity = await api.profileActivity(data.userId);
			return {
				connected: true,
				error: null,
				profile: summarizeProfile(activity.profile),
				sessions: summarizeSessions(activity.sessions),
			};
		} catch (error) {
			return { connected: true, error: getErrorMessage(error) };
		}
	});

export const setAdminUserFlagOverride = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator(
		(input: { userId: string; flagKey: string; choice: FlagOverrideChoice }) =>
			staffSetFlagOverrideInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		const { getDatabuddyApi, enqueueFlagSync } = await import(
			"#/lib/server/staff-users"
		);
		if (!getDatabuddyApi()) {
			return {
				ok: false,
				error: "Databuddy is not connected, so flags are read-only here.",
			};
		}
		const db = await staffDb();
		const { flagOverrideServices, staffUserServices } = await import(
			"@tripwire/db"
		);
		if (!(await staffUserServices.getUserStaffBits(db, data.userId))) {
			return { ok: false, error: "This user no longer exists." };
		}
		const result = await flagOverrideServices.setUserFlagOverride(db, {
			userId: data.userId,
			flagKey: data.flagKey,
			choice: data.choice,
			actorId: context.staff.userId,
		});
		if (result.changed) {
			await audit({
				actorId: context.staff.userId,
				targetUserId: data.userId,
				action: "flag.override",
				detail: { flagKey: data.flagKey, from: result.from, to: result.to },
			});
			await enqueueFlagSync(data.flagKey);
		}
		return { ok: true };
	});

export const retryAdminUserFlagSync = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string; flagKey: string }) =>
		staffRetryFlagSyncInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		const { getDatabuddyApi, enqueueFlagSync } = await import(
			"#/lib/server/staff-users"
		);
		if (!getDatabuddyApi()) {
			return { ok: false, error: "Databuddy is not connected." };
		}
		const { flagOverrideServices } = await import("@tripwire/db");
		const marked = await flagOverrideServices.markFlagOverridePending(
			await staffDb(),
			data,
		);
		if (!marked) {
			return { ok: false, error: "There is no override to sync." };
		}
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "flag.sync_retry",
			detail: { flagKey: data.flagKey },
		});
		await enqueueFlagSync(data.flagKey);
		return { ok: true };
	});

export const setAdminUserTimezone = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string; timezone: string | null }) =>
		staffSetTimezoneInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		const { accountServices } = await import("@tripwire/db");
		await accountServices.setUserTimezone(await staffDb(), data);
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "account.timezone",
			detail: { timezone: data.timezone },
		});
		return { ok: true };
	});

export const setAdminUserPlatformAdmin = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator(
		(input: { userId: string; isPlatformAdmin: boolean; confirm: string }) =>
			staffSetPlatformAdminInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		if (data.userId === context.staff.userId) {
			return {
				ok: false,
				error: "Ask another platform admin to change your own access.",
			};
		}
		const expected = await confirmTextFor(data.userId);
		if (!expected) {
			return { ok: false, error: "This user no longer exists." };
		}
		if (data.confirm.trim() !== expected) {
			return { ok: false, error: `Type ${expected} to confirm.` };
		}
		const { staffUserServices } = await import("@tripwire/db");
		const result = await staffUserServices.setPlatformAdmin(await staffDb(), {
			userId: data.userId,
			isPlatformAdmin: data.isPlatformAdmin,
		});
		if (result.changed) {
			await audit({
				actorId: context.staff.userId,
				targetUserId: data.userId,
				action: "account.platform_admin",
				detail: { isPlatformAdmin: data.isPlatformAdmin },
			});
		}
		return { ok: true };
	});

export const revokeAdminUserSession = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string; sessionId: string }) =>
		staffRevokeSessionInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		const { staffUserServices } = await import("@tripwire/db");
		const revoked = await staffUserServices.revokeUserSession(
			await staffDb(),
			data,
		);
		if (!revoked) {
			return { ok: false, error: "This session already ended." };
		}
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "session.revoke",
			detail: { sessionId: data.sessionId },
		});
		return { ok: true };
	});

export const revokeAdminUserSessions = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string }) =>
		staffUserRefSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		if (data.userId === context.staff.userId) {
			return {
				ok: false,
				error: "Use Sign out to end your own sessions.",
			};
		}
		const { staffUserServices } = await import("@tripwire/db");
		const ended = await staffUserServices.revokeAllUserSessions(
			await staffDb(),
			data.userId,
		);
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "session.revoke_all",
			detail: { ended },
		});
		return { ok: true };
	});

export const revokeAdminUserAgent = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string; clientId: string }) =>
		staffRevokeAgentInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		const { agentServices } = await import("@tripwire/db");
		await agentServices.revokeAgent(await staffDb(), data);
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "agent.revoke",
			detail: { clientId: data.clientId },
		});
		return { ok: true };
	});

function banEndOf(date: string): Date {
	return new Date(`${date}T23:59:59.999Z`);
}

export const banAdminUser = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator(
		(input: { userId: string; reason: string; endsAt: string | null }) =>
			staffBanInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		if (data.userId === context.staff.userId) {
			return { ok: false, error: "You cannot ban yourself." };
		}
		const db = await staffDb();
		const { staffUserServices } = await import("@tripwire/db");
		const bits = await staffUserServices.getUserStaffBits(db, data.userId);
		if (!bits) {
			return { ok: false, error: "This user no longer exists." };
		}
		if (bits.isPlatformAdmin) {
			return {
				ok: false,
				error: "Remove their platform admin access before you ban them.",
			};
		}
		const expires = data.endsAt ? banEndOf(data.endsAt) : null;
		if (expires && expires.getTime() <= Date.now()) {
			return { ok: false, error: "Pick an end date after today." };
		}
		const result = await staffUserServices.banUser(db, {
			userId: data.userId,
			reason: data.reason,
			expires,
		});
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "user.ban",
			detail: {
				reason: data.reason,
				endsAt: expires?.toISOString() ?? null,
				sessionsEnded: result.sessionsEnded,
			},
		});
		return { ok: true };
	});

export const unbanAdminUser = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string }) =>
		staffUserRefSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		const { staffUserServices } = await import("@tripwire/db");
		const result = await staffUserServices.unbanUser(
			await staffDb(),
			data.userId,
		);
		if (result.changed) {
			await audit({
				actorId: context.staff.userId,
				targetUserId: data.userId,
				action: "user.unban",
			});
		}
		return { ok: true };
	});

export const deleteAdminUser = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string; confirm: string }) =>
		staffDeleteUserInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<StaffActionResult> => {
		if (data.userId === context.staff.userId) {
			return {
				ok: false,
				error: "Delete your own account from your account settings.",
			};
		}
		const db = await staffDb();
		const { flagOverrideServices, staffUserServices } = await import(
			"@tripwire/db"
		);
		const bits = await staffUserServices.getUserStaffBits(db, data.userId);
		if (!bits) {
			return { ok: false, error: "This user no longer exists." };
		}
		if (bits.isPlatformAdmin) {
			return {
				ok: false,
				error: "Remove their platform admin access before you delete them.",
			};
		}
		const expected = await confirmTextFor(data.userId);
		if (!expected || data.confirm.trim() !== expected) {
			return { ok: false, error: `Type ${expected ?? bits.name} to confirm.` };
		}
		const flagKeys = await flagOverrideServices.listActiveOverrideFlagKeys(
			db,
			data.userId,
		);
		const { deleteAccount } = await import("@tripwire/auth/account-deletion");
		const result = await deleteAccount(db, data.userId);
		if (!result.ok) {
			return {
				ok: false,
				error:
					result.reason === "sole-admin"
						? `They are the only admin of ${result.orgSlugs.join(", ")}. Add another admin or delete the org first.`
						: `Tripwire is still on for ${result.repos.join(", ")}. Turn it off first.`,
			};
		}
		await audit({
			actorId: context.staff.userId,
			targetUserId: data.userId,
			action: "user.delete",
			detail: { login: expected },
		});
		const { enqueueFlagSync } = await import("#/lib/server/staff-users");
		for (const flagKey of flagKeys) {
			await enqueueFlagSync(flagKey);
		}
		return { ok: true };
	});

export const impersonateAdminUser = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		platformAdminMiddleware,
		sameOriginMiddleware,
	])
	.inputValidator((input: { userId: string }) =>
		staffUserRefSchema.parse(input),
	)
	.handler(async ({ data }): Promise<StaffActionResult> => {
		const { currentSession } = await import("#/lib/server/staff-users");
		const current = await currentSession();
		if (!current) {
			return { ok: false, error: "Your session ended. Sign in again." };
		}
		const { getErrorMessage } = await import("@tripwire/utils");
		try {
			const result = await current.auth.api.staffImpersonateUser({
				body: { userId: data.userId },
				headers: current.headers,
				returnHeaders: true,
			});
			const { setResponseHeader } = await import(
				"@tanstack/react-start/server"
			);
			setResponseHeader("set-cookie", result.headers.getSetCookie());
			return { ok: true };
		} catch (error) {
			return { ok: false, error: getErrorMessage(error) };
		}
	});

export const stopImpersonating = createServerFn({ method: "POST" })
	.middleware([sameOriginMiddleware])
	.handler(
		async (): Promise<
			{ ok: true; userId: string } | { ok: false; error: string }
		> => {
			const { currentSession, impersonatorOf } = await import(
				"#/lib/server/staff-users"
			);
			const current = await currentSession();
			const actorId = current
				? await impersonatorOf(current.session.session.id)
				: null;
			if (!(current && actorId)) {
				return { ok: false, error: "You are not impersonating anyone." };
			}
			const targetUserId = current.session.user.id;
			const result = await current.auth.api.stopImpersonating({
				headers: current.headers,
				returnHeaders: true,
			});
			const { setResponseHeader } = await import(
				"@tanstack/react-start/server"
			);
			setResponseHeader("set-cookie", result.headers.getSetCookie());
			await audit({
				actorId,
				targetUserId,
				action: "impersonation.stop",
			});
			return { ok: true, userId: targetUserId };
		},
	);

export const recordDatabuddyAnonId = createServerFn({ method: "POST" })
	.middleware([sameOriginMiddleware])
	.inputValidator((input: { anonId: string }) =>
		recordAnonIdInputSchema.parse(input),
	)
	.handler(async ({ data }): Promise<{ ok: true }> => {
		const { currentSession, impersonatorOf } = await import(
			"#/lib/server/staff-users"
		);
		const current = await currentSession();
		if (!current || (await impersonatorOf(current.session.session.id))) {
			return { ok: true };
		}
		const { staffUserServices } = await import("@tripwire/db");
		await staffUserServices.recordDatabuddyAnonId(await staffDb(), {
			userId: current.session.user.id,
			anonId: data.anonId,
		});
		return { ok: true };
	});
