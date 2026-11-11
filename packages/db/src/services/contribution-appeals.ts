import {
	type ContributionAppealDecision,
	normalizedEventSchema,
	STANDALONE_MODERATION_NODE_ID,
	submitContributionAppealSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Db } from "../client.ts";
import * as schema from "../schema/index.ts";
import {
	account,
	contributionAppeals,
	events,
	repos,
	runSteps,
	runs,
} from "../schema/index.ts";
import type { DbLike } from "./access.ts";
import { enqueueContributionAppealRestoration } from "./contribution-appeal-restoration.ts";

type Appeal = typeof contributionAppeals.$inferSelect;

async function eligibleContribution(db: DbLike, runId: string, userId: string) {
	const [row] = await db
		.select({
			forge: events.forge,
			normalized: events.normalized,
			runStatus: runs.status,
			subjectNumber: runs.subjectNumber,
			repoId: repos.id,
			repoExternalId: repos.externalId,
		})
		.from(runs)
		.innerJoin(events, eq(events.id, runs.eventId))
		.innerJoin(
			repos,
			and(eq(repos.fullName, runs.repoFullName), eq(repos.forge, events.forge)),
		)
		.where(
			and(
				eq(runs.id, runId),
				eq(runs.backfill, false),
				isNull(repos.removedAt),
			),
		)
		.limit(1);
	if (
		!row ||
		row.forge !== "github" ||
		(row.runStatus !== "completed" && row.runStatus !== "paused")
	)
		return null;
	const normalized = normalizedEventSchema.safeParse(row.normalized);
	if (
		!normalized.success ||
		!("repoExternalId" in normalized.data) ||
		normalized.data.repoExternalId !== row.repoExternalId
	)
		return null;
	const event = normalized.data;
	const thread =
		event.kind === "issue.opened"
			? event.issue
			: "changeRequest" in event
				? event.changeRequest
				: null;
	if (!thread || thread.number !== row.subjectNumber) return null;

	const [identity] = await db
		.select({ id: account.id })
		.from(account)
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, "github"),
				eq(account.accountId, event.actor.externalId),
			),
		)
		.limit(1);
	if (!identity) return null;

	const [outcome] = await db
		.select({ id: runSteps.id })
		.from(runSteps)
		.where(
			and(
				eq(runSteps.runId, runId),
				eq(runSteps.nodeId, STANDALONE_MODERATION_NODE_ID),
			),
		)
		.limit(1);
	if (!outcome) return null;

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

export async function getOwnAppeal(db: DbLike, runId: string, userId: string) {
	if (!(await eligibleContribution(db, runId, userId))) return null;
	const [appeal] = await db
		.select({ status: contributionAppeals.status })
		.from(contributionAppeals)
		.where(eq(contributionAppeals.runId, runId))
		.limit(1);
	return { status: appeal?.status ?? null };
}

export async function submitAppeal(
	db: Db,
	input: { runId: string; reason: string; userId: string },
) {
	const { runId, reason } = submitContributionAppealSchema.parse(input);
	return db.transaction(async (tx) => {
		const subject = await eligibleContribution(tx, runId, input.userId);
		if (!subject) return null;
		await tx
			.insert(contributionAppeals)
			.values({
				id: generateId(),
				runId,
				reason,
				...subject,
			})
			.onConflictDoNothing({ target: contributionAppeals.runId });
		return getOwnAppeal(tx, runId, input.userId);
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
