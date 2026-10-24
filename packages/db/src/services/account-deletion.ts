import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { session, user } from "../schema/auth.ts";
import { moderationItems } from "../schema/moderation.ts";
import { agentGrants, deviceCode } from "../schema/oauth.ts";
import {
	member,
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";
import { recordFlagOverrideRemovals } from "./flag-overrides.ts";

export const DELETED_ACCOUNT_ACTOR = "account:deleted";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const holdsAdmin = (role: typeof member.role) =>
	sql<boolean>`'admin' = ANY(string_to_array(replace(${role}, ' ', ''), ','))`;

export interface AccountMembership {
	orgId: string;
	slug: string;
	name: string;
	isPersonal: boolean;
	avatarHue: number | null;
	role: string;
	members: number;
}

export interface SoleAdminOrg {
	orgId: string;
	slug: string;
	name: string;
	avatarHue: number | null;
	members: number;
}

export interface OnRepo {
	id: string;
	fullName: string;
	orgId: string;
}

export interface OrgInstallation {
	forge: string;
	installationId: string;
	accountLogin: string | null;
	accountType: string | null;
}

export async function listAccountMemberships(
	db: Db,
	userId: string,
): Promise<AccountMembership[]> {
	return await db
		.select({
			orgId: organization.id,
			slug: organization.slug,
			name: organization.name,
			isPersonal: organization.isPersonal,
			avatarHue: organization.avatarHue,
			role: member.role,
			members: sql<number>`(SELECT count(*)::int FROM member m2 WHERE m2.organization_id = ${organization.id})`,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(sql`${organization.isPersonal} DESC, ${organization.name}`);
}

export async function listSoleAdminOrgs(
	db: Executor,
	userId: string,
): Promise<SoleAdminOrg[]> {
	return await db
		.select({
			orgId: organization.id,
			slug: organization.slug,
			name: organization.name,
			avatarHue: organization.avatarHue,
			members: sql<number>`(SELECT count(*)::int FROM member m2 WHERE m2.organization_id = ${organization.id})`,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(
			and(
				eq(member.userId, userId),
				eq(organization.isPersonal, false),
				holdsAdmin(member.role),
				sql`(SELECT count(*) FROM member m2 WHERE m2.organization_id = ${organization.id} AND 'admin' = ANY(string_to_array(replace(m2.role, ' ', ''), ','))) = 1`,
			),
		)
		.orderBy(organization.name);
}

export async function listOtherMemberRoles(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<string[]> {
	const rows = await db
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.orgId),
				ne(member.userId, input.userId),
			),
		);
	return rows.map((row) => row.role);
}

export async function listOnRepos(
	db: Db,
	orgIds: readonly string[],
): Promise<OnRepo[]> {
	if (orgIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({ id: repos.id, fullName: repos.fullName, orgId: repos.orgId })
		.from(repos)
		.where(
			and(
				inArray(repos.orgId, [...orgIds]),
				eq(repos.armed, true),
				isNull(repos.removedAt),
			),
		)
		.orderBy(repos.fullName);
	return rows.flatMap((row) =>
		row.orgId ? [{ id: row.id, fullName: row.fullName, orgId: row.orgId }] : [],
	);
}

export async function listOrgInstallations(
	db: Db,
	orgIds: readonly string[],
): Promise<OrgInstallation[]> {
	if (orgIds.length === 0) {
		return [];
	}
	return await db
		.select({
			forge: organizationInstallations.forge,
			installationId: organizationInstallations.installationId,
			accountLogin: organizationInstallations.accountLogin,
			accountType: organizationInstallations.accountType,
		})
		.from(organizationInstallations)
		.where(inArray(organizationInstallations.organizationId, [...orgIds]))
		.orderBy(organizationInstallations.createdAt);
}

export async function countPendingReviews(
	db: Db,
	orgIds: readonly string[],
): Promise<number> {
	if (orgIds.length === 0) {
		return 0;
	}
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(moderationItems)
		.innerJoin(runs, eq(runs.id, moderationItems.runId))
		.innerJoin(repos, eq(repos.fullName, runs.repoFullName))
		.where(
			and(
				eq(moderationItems.status, "pending"),
				inArray(repos.orgId, [...orgIds]),
				isNull(repos.removedAt),
			),
		);
	return rows[0]?.n ?? 0;
}

export async function countLiveSessions(
	db: Db,
	userId: string,
	now = new Date(),
): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(session)
		.where(and(eq(session.userId, userId), gt(session.expiresAt, now)));
	return rows[0]?.n ?? 0;
}

export async function countAgentGrants(
	db: Db,
	userId: string,
): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(agentGrants)
		.where(eq(agentGrants.userId, userId));
	return rows[0]?.n ?? 0;
}

export class AccountDeletionBlockedError extends Error {
	readonly orgSlugs: string[];
	constructor(orgSlugs: string[]) {
		super(
			`You are the only admin of ${orgSlugs.join(", ")}. Add another admin or delete the org first.`,
		);
		this.name = "AccountDeletionBlockedError";
		this.orgSlugs = orgSlugs;
	}
}

export interface DeletedAccount {
	deleted: boolean;
	personalOrgs: number;
	reposRemoved: number;
	flagKeys: string[];
}

async function lockMemberOrgs(tx: Tx, userId: string): Promise<void> {
	await tx
		.select({ id: organization.id })
		.from(organization)
		.where(
			inArray(
				organization.id,
				tx
					.select({ id: member.organizationId })
					.from(member)
					.where(eq(member.userId, userId)),
			),
		)
		.orderBy(organization.id)
		.for("update");
}

export async function deleteUserAccount(
	db: Db,
	userId: string,
): Promise<DeletedAccount> {
	return await db.transaction(async (tx) => {
		const found = await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, userId))
			.for("update");
		if (!found[0]) {
			return {
				deleted: false,
				personalOrgs: 0,
				reposRemoved: 0,
				flagKeys: [],
			};
		}
		await tx
			.select({ id: member.id })
			.from(member)
			.where(eq(member.userId, userId))
			.for("update");
		await lockMemberOrgs(tx, userId);
		const soleAdmin = await listSoleAdminOrgs(tx, userId);
		if (soleAdmin.length > 0) {
			throw new AccountDeletionBlockedError(soleAdmin.map((org) => org.slug));
		}
		const personal = await tx
			.select({ id: organization.id })
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(and(eq(member.userId, userId), eq(organization.isPersonal, true)));
		const personalIds = personal.map((org) => org.id);
		const removed = personalIds.length
			? await tx
					.update(repos)
					.set({ orgId: null, removedAt: new Date() })
					.where(inArray(repos.orgId, personalIds))
					.returning({ id: repos.id })
			: [];
		if (personalIds.length) {
			await tx
				.delete(organization)
				.where(inArray(organization.id, personalIds));
		}
		await tx
			.update(runs)
			.set({ triggeredBy: DELETED_ACCOUNT_ACTOR })
			.where(eq(runs.triggeredBy, userId));
		await tx
			.update(user)
			.set({ accessReviewedBy: null })
			.where(eq(user.accessReviewedBy, userId));
		await tx.delete(session).where(eq(session.impersonatedBy, userId));
		await tx.delete(deviceCode).where(eq(deviceCode.userId, userId));
		const flagKeys = await recordFlagOverrideRemovals(tx, userId);
		await tx.delete(user).where(eq(user.id, userId));
		return {
			deleted: true,
			personalOrgs: personalIds.length,
			reposRemoved: removed.length,
			flagKeys,
		};
	});
}
