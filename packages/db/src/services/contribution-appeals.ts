import {
	type AppealPortalSettings,
	appealPortalSettingsSchema,
	type ContributionAppealDecision,
	DEFAULT_APPEAL_PORTAL_SETTINGS,
	normalizedEventSchema,
	STANDALONE_MODERATION_NODE_ID,
	type SubmitOrganizationAppeal,
	submitContributionAppealSchema,
	submitOrganizationAppealSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Db } from "../client.ts";
import * as schema from "../schema/index.ts";
import {
	account,
	contributionAppeals,
	events,
	organization,
	organizationAppealPortalSettings,
	organizationAppeals,
	repos,
	runSteps,
	runs,
} from "../schema/index.ts";
import type { DbLike } from "./access.ts";
import { enqueueContributionAppealRestoration } from "./contribution-appeal-restoration.ts";

type Appeal = typeof contributionAppeals.$inferSelect;

function appealCandidates(db: DbLike) {
	return db
		.select({
			runId: runs.id,
			normalized: events.normalized,
			subjectNumber: runs.subjectNumber,
			repoId: repos.id,
			orgId: repos.orgId,
			repoName: repos.fullName,
			repoExternalId: repos.externalId,
			appealId: contributionAppeals.id,
			status: contributionAppeals.status,
		})
		.from(runs)
		.innerJoin(events, eq(events.id, runs.eventId))
		.innerJoin(
			repos,
			and(eq(repos.fullName, runs.repoFullName), eq(repos.forge, events.forge)),
		)
		.leftJoin(contributionAppeals, eq(contributionAppeals.runId, runs.id));
}

function linkedGitHubAccount(userId: string, githubId: ReturnType<typeof sql>) {
	return sql`exists (
		select 1 from ${account}
		where ${account.userId} = ${userId}
		  and ${account.providerId} = 'github'
		  and ${account.accountId} = ${githubId}
	)`;
}

function appealEligibility(userId: string) {
	return and(
		eq(events.forge, "github"),
		eq(runs.backfill, false),
		inArray(runs.status, ["completed", "paused"]),
		isNull(repos.removedAt),
		sql`(${runs.verdict} in ('block', 'close') or ${contributionAppeals.id} is not null)`,
		sql`${events.normalized}->>'repoExternalId' = ${repos.externalId}`,
		linkedGitHubAccount(
			userId,
			sql`${events.normalized}#>>'{actor,externalId}'`,
		),
		sql`exists (
			select 1 from ${runSteps}
			where ${runSteps.runId} = ${runs.id}
			  and ${runSteps.nodeId} = ${STANDALONE_MODERATION_NODE_ID}
		)`,
	);
}

function appealSubject(
	row: Awaited<ReturnType<typeof appealCandidates>>[number],
) {
	const parsed = normalizedEventSchema.safeParse(row.normalized);
	if (!parsed.success) return null;
	const event = parsed.data;
	const thread =
		event.kind === "issue.opened"
			? event.issue
			: "changeRequest" in event
				? event.changeRequest
				: null;
	if (!thread || thread.number !== row.subjectNumber) return null;
	return {
		repoId: row.repoId,
		subjectKind:
			event.kind === "issue.opened"
				? ("issue" as const)
				: ("change-request" as const),
		subjectNumber: thread.number,
		accountId: event.actor.externalId,
		login: event.actor.login,
	};
}

async function eligibleContribution(db: DbLike, runId: string, userId: string) {
	const [row] = await appealCandidates(db)
		.where(and(eq(runs.id, runId), appealEligibility(userId)))
		.limit(1);
	const subject = row && appealSubject(row);
	return subject && row ? { row, subject } : null;
}

async function pendingAppeal(db: DbLike, userId: string) {
	const [row] = await db
		.select({ runId: contributionAppeals.runId })
		.from(contributionAppeals)
		.where(
			and(
				eq(contributionAppeals.status, "pending"),
				linkedGitHubAccount(userId, sql`${contributionAppeals.accountId}`),
			),
		)
		.orderBy(asc(contributionAppeals.createdAt), asc(contributionAppeals.id))
		.limit(1);
	return row?.runId ?? null;
}

async function pendingOrganizationAppeal(db: DbLike, userId: string) {
	const [row] = await db
		.select({ slug: organization.slug })
		.from(organizationAppeals)
		.innerJoin(organization, eq(organization.id, organizationAppeals.orgId))
		.where(
			and(
				isNull(organizationAppeals.resolvedAt),
				linkedGitHubAccount(userId, sql`${organizationAppeals.accountId}`),
			),
		)
		.limit(1);
	return row?.slug ?? null;
}

async function lockAppealSubmission(
	db: DbLike,
	userId: string,
	accountId: string,
) {
	await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`appeal-user:${userId}`}, 0))`,
	);
	await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`appeal-github:${accountId}`}, 0))`,
	);
}

async function listOwnOrganizationAppeals(
	db: DbLike,
	org: string,
	userId: string,
) {
	return db
		.select({
			id: organizationAppeals.id,
			type: organizationAppeals.type,
			resolvedAt: organizationAppeals.resolvedAt,
		})
		.from(organizationAppeals)
		.innerJoin(organization, eq(organization.id, organizationAppeals.orgId))
		.where(
			and(
				eq(organization.slug, org),
				linkedGitHubAccount(userId, sql`${organizationAppeals.accountId}`),
			),
		)
		.orderBy(desc(organizationAppeals.createdAt), desc(organizationAppeals.id))
		.limit(50);
}

export async function getAppealPortal(
	db: DbLike,
	org: string,
): Promise<{
	orgId: string;
	orgName: string;
	avatarHue: number | null;
	settings: AppealPortalSettings;
} | null> {
	const [row] = await db
		.select({
			orgId: organization.id,
			orgName: organization.name,
			avatarHue: organization.avatarHue,
			settings: organizationAppealPortalSettings.settings,
		})
		.from(organization)
		.leftJoin(
			organizationAppealPortalSettings,
			eq(organizationAppealPortalSettings.organizationId, organization.id),
		)
		.where(eq(organization.slug, org))
		.limit(1);
	if (!row) return null;
	const parsed = appealPortalSettingsSchema.safeParse(row.settings);
	return {
		orgId: row.orgId,
		orgName: row.orgName,
		avatarHue: row.avatarHue,
		settings: parsed.success ? parsed.data : DEFAULT_APPEAL_PORTAL_SETTINGS,
	};
}

export async function updateAppealPortalSettings(
	db: DbLike,
	input: { orgId: string; settings: AppealPortalSettings },
): Promise<void> {
	const settings = appealPortalSettingsSchema.parse(input.settings);
	await db
		.insert(organizationAppealPortalSettings)
		.values({ organizationId: input.orgId, settings })
		.onConflictDoUpdate({
			target: organizationAppealPortalSettings.organizationId,
			set: { settings, updatedAt: new Date() },
		});
}

export async function listOrganizationAppealInbox(db: DbLike, orgId: string) {
	const [contributions, organizationRequests] = await Promise.all([
		db
			.select({
				id: contributionAppeals.id,
				runId: contributionAppeals.runId,
				repo: repos.name,
				repoName: repos.fullName,
				subjectKind: contributionAppeals.subjectKind,
				subjectNumber: contributionAppeals.subjectNumber,
				login: contributionAppeals.login,
				reason: contributionAppeals.reason,
				createdAt: contributionAppeals.createdAt,
			})
			.from(contributionAppeals)
			.innerJoin(repos, eq(repos.id, contributionAppeals.repoId))
			.where(
				and(eq(repos.orgId, orgId), eq(contributionAppeals.status, "pending")),
			)
			.orderBy(asc(contributionAppeals.createdAt))
			.limit(100),
		listPendingOrganizationAppeals(db, orgId),
	]);
	return { contributions, organizationAppeals: organizationRequests };
}

async function linkedGitHubIdentity(db: DbLike, userId: string) {
	const [row] = await db
		.select({ accountId: account.accountId })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, "github")))
		.limit(1);
	return row ?? null;
}

export async function submitOrganizationAppeal(
	db: Db,
	input: SubmitOrganizationAppeal & { userId: string },
) {
	const { org, type, reason } = submitOrganizationAppealSchema.parse(input);
	const { userId } = input;
	return db.transaction(async (tx) => {
		const [orgRow, githubIdentity] = await Promise.all([
			tx
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.slug, org))
				.limit(1)
				.then((rows) => rows[0] ?? null),
			linkedGitHubIdentity(tx, userId),
		]);
		if (!orgRow || !githubIdentity) return { status: "unavailable" } as const;
		const appealIdentity = {
			orgId: orgRow.id,
			accountId: githubIdentity.accountId,
		};
		await lockAppealSubmission(tx, userId, appealIdentity.accountId);
		if (
			(await pendingAppeal(tx, userId)) ||
			(await pendingOrganizationAppeal(tx, userId))
		)
			return { status: "already-pending" } as const;
		const id = generateId();
		await tx
			.insert(organizationAppeals)
			.values({ ...appealIdentity, id, type, reason });
		return { status: "submitted", id } as const;
	});
}

export async function listPendingOrganizationAppeals(
	db: DbLike,
	orgId: string,
) {
	return db
		.select({
			id: organizationAppeals.id,
			accountId: organizationAppeals.accountId,
			type: organizationAppeals.type,
			reason: organizationAppeals.reason,
		})
		.from(organizationAppeals)
		.where(
			and(
				eq(organizationAppeals.orgId, orgId),
				isNull(organizationAppeals.resolvedAt),
			),
		)
		.orderBy(asc(organizationAppeals.createdAt))
		.limit(100);
}

export async function resolveOrganizationAppeal(
	db: DbLike,
	input: { orgId: string; appealId: string; userId: string },
) {
	const [row] = await db
		.update(organizationAppeals)
		.set({ resolvedAt: new Date(), resolvedBy: input.userId })
		.where(
			and(
				eq(organizationAppeals.orgId, input.orgId),
				eq(organizationAppeals.id, input.appealId),
				isNull(organizationAppeals.resolvedAt),
			),
		)
		.returning({ id: organizationAppeals.id });
	return Boolean(row);
}

export async function listOwnAppealCases(
	db: DbLike,
	org: string,
	userId: string,
) {
	const [rows, pendingRunId, pendingOrgSlug, requests] = await Promise.all([
		appealCandidates(db)
			.innerJoin(organization, eq(organization.id, repos.orgId))
			.where(
				and(
					eq(organization.slug, org),
					appealEligibility(userId),
					sql`${contributionAppeals.id} is not null`,
				),
			)
			.orderBy(desc(runs.createdAt), desc(runs.id))
			.limit(50),
		pendingAppeal(db, userId),
		pendingOrganizationAppeal(db, userId),
		listOwnOrganizationAppeals(db, org, userId),
	]);
	return {
		pendingRunId,
		pendingOrgSlug,
		requests,
		cases: rows.flatMap((row) => {
			const subject = appealSubject(row);
			return subject
				? [
						{
							runId: row.runId,
							appealId: row.appealId,
							status: row.status,
							repoName: row.repoName,
							subjectKind: subject.subjectKind,
							subjectNumber: subject.subjectNumber,
						},
					]
				: [];
		}),
	};
}

export async function getOwnAppeal(db: DbLike, runId: string, userId: string) {
	const eligible = await eligibleContribution(db, runId, userId);
	if (!eligible) return null;
	const { row } = eligible;
	return {
		status: row.status,
		appealId: row.appealId,
		pendingRunId: row.status ? null : await pendingAppeal(db, userId),
		pendingOrgSlug: row.status
			? null
			: await pendingOrganizationAppeal(db, userId),
	};
}

export async function submitAppeal(
	db: Db,
	input: { runId: string; reason: string; userId: string },
) {
	const { userId } = input;
	const { runId, reason } = submitContributionAppealSchema.parse(input);
	return db.transaction(async (tx) => {
		const eligible = await eligibleContribution(tx, runId, userId);
		if (!eligible) return null;
		const { subject } = eligible;
		await lockAppealSubmission(tx, userId, subject.accountId);
		const current = await getOwnAppeal(tx, runId, userId);
		if (
			!current ||
			current.status ||
			current.pendingRunId ||
			current.pendingOrgSlug
		)
			return current;
		await tx
			.insert(contributionAppeals)
			.values({ id: generateId(), runId, reason, ...subject })
			.onConflictDoNothing({ target: contributionAppeals.runId });
		return getOwnAppeal(tx, runId, userId);
	});
}

export async function listPendingAppeals(db: DbLike, repoId: string) {
	return db
		.select()
		.from(contributionAppeals)
		.where(
			and(
				eq(contributionAppeals.repoId, repoId),
				eq(contributionAppeals.status, "pending"),
			),
		)
		.orderBy(contributionAppeals.createdAt)
		.limit(100);
}

export async function getApprovedAppealId(
	db: DbLike,
	subject: Pick<
		Appeal,
		"repoId" | "subjectKind" | "subjectNumber" | "accountId"
	>,
): Promise<string | null> {
	const [row] = await db
		.select({ id: contributionAppeals.id })
		.from(contributionAppeals)
		.where(
			and(
				eq(contributionAppeals.repoId, subject.repoId),
				eq(contributionAppeals.subjectKind, subject.subjectKind),
				eq(contributionAppeals.subjectNumber, subject.subjectNumber),
				eq(contributionAppeals.accountId, subject.accountId),
				inArray(contributionAppeals.status, ["approve-once", "approve-author"]),
			),
		)
		.limit(1);
	return row?.id ?? null;
}

export async function decideAppeal(
	db: Db,
	input: {
		repoId: string;
		appealId: string;
		decidedBy: string;
		decision: ContributionAppealDecision;
	},
	applyApproval: (
		tx: DbLike,
		appeal: Appeal,
		decision: "approve-once" | "approve-author",
	) => Promise<void>,
	queue?: { pool: Pool; boss: PgBoss },
) {
	const apply = async (tx: DbLike) => {
		const [appeal] = await tx
			.update(contributionAppeals)
			.set({
				status: input.decision,
				decidedAt: new Date(),
				decidedBy: input.decidedBy,
			})
			.where(
				and(
					eq(contributionAppeals.id, input.appealId),
					eq(contributionAppeals.repoId, input.repoId),
					eq(contributionAppeals.status, "pending"),
				),
			)
			.returning();
		if (!appeal) return false;
		if (input.decision !== "deny")
			await applyApproval(tx, appeal, input.decision);
		return true;
	};
	if (!queue) return db.transaction(apply);
	const client = await queue.pool.connect();
	try {
		return await drizzle(client, { schema }).transaction(async (tx) => {
			const changed = await apply(tx);
			if (changed && input.decision !== "deny")
				await enqueueContributionAppealRestoration(
					client,
					queue.boss,
					input.appealId,
				);
			return changed;
		});
	} finally {
		client.release();
	}
}
