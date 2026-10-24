import type { AccessStatus } from "@tripwire/contracts";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../client.ts";
import { account, forgeIdentities, session, user } from "../schema/auth.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { member, organization } from "../schema/organizations.ts";
import { runs } from "../schema/runs.ts";
import type { DbLike } from "./access.ts";
import { liveRun, runBearsVerdict } from "./runs.ts";

export interface StaffUserDetail {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	login: string | null;
	accessStatus: AccessStatus;
	accessReviewedAt: Date | null;
	reviewedBy: { id: string; name: string } | null;
	waitlistedAt: Date | null;
	isPlatformAdmin: boolean;
	rerunCooldownExempt: boolean;
	role: string | null;
	banned: boolean;
	banReason: string | null;
	banExpires: Date | null;
	timezone: string | null;
	createdAt: Date;
	lastSeenAt: Date | null;
	personalOrgSlug: string | null;
	providers: string[];
	databuddyAnonId: string | null;
	databuddyAnonIdAt: Date | null;
}

export async function getStaffUserDetail(
	db: Db,
	userId: string,
): Promise<StaffUserDetail | null> {
	const reviewer = alias(user, "reviewer");
	const rows = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			accessStatus: user.accessStatus,
			accessReviewedAt: user.accessReviewedAt,
			reviewerId: reviewer.id,
			reviewerName: reviewer.name,
			waitlistedAt: user.waitlistedAt,
			isPlatformAdmin: user.isPlatformAdmin,
			rerunCooldownExempt: user.rerunCooldownExempt,
			role: user.role,
			banned: user.banned,
			banReason: user.banReason,
			banExpires: user.banExpires,
			timezone: user.timezone,
			createdAt: user.createdAt,
			lastSeenAt: user.lastSeenAt,
			databuddyAnonId: user.databuddyAnonId,
			databuddyAnonIdAt: user.databuddyAnonIdAt,
		})
		.from(user)
		.leftJoin(reviewer, eq(reviewer.id, user.accessReviewedBy))
		.where(eq(user.id, userId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		return null;
	}
	const [identities, personal, providers] = await Promise.all([
		db
			.select({ username: forgeIdentities.username })
			.from(forgeIdentities)
			.where(eq(forgeIdentities.userId, userId))
			.orderBy(forgeIdentities.createdAt)
			.limit(1),
		db
			.select({ slug: organization.slug })
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(and(eq(member.userId, userId), eq(organization.isPersonal, true)))
			.limit(1),
		db
			.selectDistinct({ providerId: account.providerId })
			.from(account)
			.where(eq(account.userId, userId)),
	]);
	const { reviewerId, reviewerName, ...rest } = row;
	return {
		...rest,
		login: identities[0]?.username ?? null,
		reviewedBy:
			reviewerId && reviewerName
				? { id: reviewerId, name: reviewerName }
				: null,
		personalOrgSlug: personal[0]?.slug ?? null,
		providers: providers.map((p) => p.providerId).sort(),
	};
}

export interface StaffUserSession {
	id: string;
	userAgent: string | null;
	ipAddress: string | null;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
	impersonatedBy: string | null;
}

export async function listUserSessions(
	db: Db,
	userId: string,
): Promise<StaffUserSession[]> {
	return await db
		.select({
			id: session.id,
			userAgent: session.userAgent,
			ipAddress: session.ipAddress,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			expiresAt: session.expiresAt,
			impersonatedBy: session.impersonatedBy,
		})
		.from(session)
		.where(and(eq(session.userId, userId), gt(session.expiresAt, sql`now()`)))
		.orderBy(desc(session.updatedAt));
}

export async function revokeUserSession(
	db: Db,
	input: { userId: string; sessionId: string },
): Promise<boolean> {
	const rows = await db
		.delete(session)
		.where(
			and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
		)
		.returning({ id: session.id });
	return rows.length > 0;
}

export async function revokeAllUserSessions(
	db: DbLike,
	userId: string,
): Promise<number> {
	const rows = await db
		.delete(session)
		.where(eq(session.userId, userId))
		.returning({ id: session.id });
	return rows.length;
}

export interface StaffForgeIdentity {
	forge: string;
	username: string;
	externalId: string;
	createdAt: Date;
}

export async function listUserForgeIdentities(
	db: Db,
	userId: string,
): Promise<StaffForgeIdentity[]> {
	return await db
		.select({
			forge: forgeIdentities.forge,
			username: forgeIdentities.username,
			externalId: forgeIdentities.externalId,
			createdAt: forgeIdentities.createdAt,
		})
		.from(forgeIdentities)
		.where(eq(forgeIdentities.userId, userId))
		.orderBy(forgeIdentities.createdAt);
}

export interface StaffModerationDecision {
	itemId: string;
	runId: string;
	status: string;
	repoFullName: string;
	subjectNumber: number | null;
	decidedAt: Date | null;
}

export async function listModerationDecisionsBy(
	db: Db,
	userId: string,
	limit = 20,
): Promise<{ items: StaffModerationDecision[]; total: number }> {
	const where = eq(moderationItems.decidedBy, userId);
	const [items, totals] = await Promise.all([
		db
			.select({
				itemId: moderationItems.id,
				runId: moderationItems.runId,
				status: moderationItems.status,
				repoFullName: runs.repoFullName,
				subjectNumber: runs.subjectNumber,
				decidedAt: moderationItems.decidedAt,
			})
			.from(moderationItems)
			.innerJoin(runs, eq(runs.id, moderationItems.runId))
			.where(where)
			.orderBy(desc(moderationItems.decidedAt), desc(moderationItems.id))
			.limit(limit),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(moderationItems)
			.where(where),
	]);
	return { items, total: totals[0]?.n ?? 0 };
}

export interface StaffContributorRun {
	runId: string;
	verdict: string | null;
	status: string;
	repoFullName: string;
	subjectNumber: number | null;
	createdAt: Date;
	blockingRuleId: string | null;
	humanReviewed: boolean;
}

export async function listContributorRuns(
	db: Db,
	logins: readonly string[],
	limit = 20,
): Promise<{ runs: StaffContributorRun[]; total: number }> {
	const lowered = [...new Set(logins.map((login) => login.toLowerCase()))];
	if (lowered.length === 0) {
		return { runs: [], total: 0 };
	}
	const where = and(
		inArray(sql`lower(${events.actorLogin})`, lowered),
		runBearsVerdict,
		liveRun,
	);
	const [rows, totals] = await Promise.all([
		db
			.select({
				runId: runs.id,
				verdict: runs.verdict,
				status: runs.status,
				repoFullName: runs.repoFullName,
				subjectNumber: runs.subjectNumber,
				createdAt: runs.createdAt,
				blockingRuleId: sql<
					string | null
				>`(select s.rule_id from run_steps s where s.run_id = ${runs.id} and s.node_kind = 'rule' and s.status = 'fail' order by s.started_at limit 1)`,
				humanReviewed: sql<boolean>`exists (select 1 from moderation_items m where m.run_id = ${runs.id} and m.status in ('approved', 'denied'))`,
			})
			.from(runs)
			.innerJoin(events, eq(events.id, runs.eventId))
			.where(where)
			.orderBy(desc(runs.createdAt), desc(runs.id))
			.limit(limit),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(runs)
			.innerJoin(events, eq(events.id, runs.eventId))
			.where(where),
	]);
	return { runs: rows, total: totals[0]?.n ?? 0 };
}

export async function setPlatformAdmin(
	db: DbLike,
	input: { userId: string; isPlatformAdmin: boolean },
): Promise<{ changed: boolean }> {
	const rows = await db
		.update(user)
		.set({ isPlatformAdmin: input.isPlatformAdmin, updatedAt: new Date() })
		.where(
			and(
				eq(user.id, input.userId),
				eq(user.isPlatformAdmin, !input.isPlatformAdmin),
			),
		)
		.returning({ id: user.id });
	return { changed: rows.length > 0 };
}

export async function banUser(
	db: Db,
	input: { userId: string; reason: string; expires: Date | null },
): Promise<{ banned: boolean; sessionsEnded: number }> {
	return await db.transaction(async (tx) => {
		const rows = await tx
			.update(user)
			.set({
				banned: true,
				banReason: input.reason,
				banExpires: input.expires,
				updatedAt: new Date(),
			})
			.where(eq(user.id, input.userId))
			.returning({ id: user.id });
		if (rows.length === 0) {
			return { banned: false, sessionsEnded: 0 };
		}
		const sessionsEnded = await revokeAllUserSessions(tx, input.userId);
		return { banned: true, sessionsEnded };
	});
}

export async function unbanUser(
	db: Db,
	userId: string,
): Promise<{ changed: boolean }> {
	const rows = await db
		.update(user)
		.set({
			banned: false,
			banReason: null,
			banExpires: null,
			updatedAt: new Date(),
		})
		.where(and(eq(user.id, userId), eq(user.banned, true)))
		.returning({ id: user.id });
	return { changed: rows.length > 0 };
}

export async function isUserBanned(
	db: Db,
	userId: string,
	now = new Date(),
): Promise<boolean> {
	const rows = await db
		.select({ banned: user.banned, banExpires: user.banExpires })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const row = rows[0];
	if (!row?.banned) {
		return false;
	}
	return row.banExpires === null || row.banExpires.getTime() > now.getTime();
}

export async function recordDatabuddyAnonId(
	db: Db,
	input: { userId: string; anonId: string },
): Promise<{ changed: boolean }> {
	const rows = await db
		.update(user)
		.set({ databuddyAnonId: input.anonId, databuddyAnonIdAt: new Date() })
		.where(
			and(
				eq(user.id, input.userId),
				or(
					isNull(user.databuddyAnonId),
					ne(user.databuddyAnonId, input.anonId),
				),
			),
		)
		.returning({ id: user.id });
	return { changed: rows.length > 0 };
}

export async function getUserLogins(db: Db, userId: string): Promise<string[]> {
	const rows = await db
		.select({ username: forgeIdentities.username })
		.from(forgeIdentities)
		.where(eq(forgeIdentities.userId, userId));
	return rows.map((row) => row.username);
}

export async function getUserStaffBits(
	db: Db,
	userId: string,
): Promise<{
	isPlatformAdmin: boolean;
	role: string | null;
	banned: boolean;
	name: string;
} | null> {
	const rows = await db
		.select({
			isPlatformAdmin: user.isPlatformAdmin,
			role: user.role,
			banned: user.banned,
			name: user.name,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0] ?? null;
}

export async function getSessionImpersonator(
	db: Db,
	sessionId: string,
): Promise<string | null> {
	const rows = await db
		.select({ impersonatedBy: session.impersonatedBy })
		.from(session)
		.where(eq(session.id, sessionId))
		.limit(1);
	return rows[0]?.impersonatedBy ?? null;
}

export async function getSessionGuardState(
	db: Db,
	input: { userId: string; sessionId: string },
	now = new Date(),
): Promise<{ banned: boolean; impersonatedBy: string | null }> {
	const rows = await db
		.select({
			banned: user.banned,
			banExpires: user.banExpires,
			impersonatedBy: session.impersonatedBy,
		})
		.from(user)
		.leftJoin(
			session,
			and(eq(session.id, input.sessionId), eq(session.userId, user.id)),
		)
		.where(eq(user.id, input.userId))
		.limit(1);
	const row = rows[0];
	const banned =
		row?.banned === true &&
		(row.banExpires === null || row.banExpires.getTime() > now.getTime());
	return { banned, impersonatedBy: row?.impersonatedBy ?? null };
}
