import {
	forgeSchema,
	RUN_RESULT_LABELS,
	renderClosedBeforeReviewComment,
	VERDICT_EVENT_KINDS,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, inArray, ne, type SQL, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Db } from "../client.ts";
import { RESUME_RUN_QUEUE } from "../queue.ts";
import { moderationItems } from "../schema/moderation.ts";
import { runActions, runs } from "../schema/runs.ts";
import { getRepoByFullName, getResponseConfig } from "./repos.ts";
import {
	getLatestRunIdForChangeRequest,
	getRunById,
	recordActions,
} from "./runs.ts";

/**
 * Moderation queue = a paused run (§6), not a separate system. A decision
 * records here and enqueues a resume job — the WORKER walks the decision edge
 * (only the worker may run the executor). Same tx discipline as ingest.
 */

export async function createModerationItem(
	db: Db,
	input: { runId: string; nodeId: string },
): Promise<string> {
	const id = generateId();
	await db.insert(moderationItems).values({
		id,
		runId: input.runId,
		nodeId: input.nodeId,
	});
	return id;
}

const pendingRow = z.object({
	id: z.string(),
	runId: z.string(),
	nodeId: z.string(),
	createdAt: z.coerce.date(),
	repoFullName: z.string(),
	subjectNumber: z.number().nullable(),
	actorLogin: z.string().nullable(),
	eventKind: z.string().nullable(),
	title: z.string().nullable(),
	reason: z.string().nullable(),
});

export const PENDING_ITEMS_LIMIT = 200;

/** The moderation queue, SCOPED to the user's active repo (§10). */
export async function listPendingItems(
	db: Db,
	repoFullName: string | readonly string[],
	limit = PENDING_ITEMS_LIMIT,
) {
	const names =
		typeof repoFullName === "string" ? [repoFullName] : repoFullName;
	if (names.length === 0) {
		return [];
	}
	const result = await db.execute(sql`
		SELECT m.id, m.run_id AS "runId", m.node_id AS "nodeId",
		       m.created_at AS "createdAt", r.repo_full_name AS "repoFullName",
		       r.subject_number AS "subjectNumber", e.actor_login AS "actorLogin",
		       e.kind AS "eventKind",
		       e.normalized->'changeRequest'->>'title' AS title,
		       fr.summary AS reason
		FROM moderation_items m
		JOIN runs r ON r.id = m.run_id
		LEFT JOIN events e ON e.id = r.event_id
		LEFT JOIN LATERAL (
			SELECT s.summary FROM run_steps s
			WHERE s.run_id = r.id AND s.node_kind = 'rule' AND s.status = 'fail'
			ORDER BY s.started_at ASC LIMIT 1
		) fr ON true
		WHERE m.status = 'pending'
		  AND r.repo_full_name IN (${sql.join(
				names.map((name) => sql`${name}`),
				sql`, `,
			)})
		ORDER BY m.id DESC
		LIMIT ${limit}
	`);
	return z.array(pendingRow).parse(result.rows);
}

/**
 * §6 — approve/deny resumes the run down the corresponding edge. ONE
 * transaction: mark decided + enqueue the resume job.
 */
export async function decideModerationItem(
	pool: Pool,
	boss: PgBoss,
	input: {
		itemId: string;
		decision: "approve" | "deny";
		decidedBy: string | null;
		note?: string;
	},
): Promise<boolean> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const updated = await client.query<{ id: string }>(
			`UPDATE moderation_items
			 SET status = $2, decided_at = now(), decided_by = $3, note = $4
			 WHERE id = $1 AND status = 'pending'
			 RETURNING id`,
			[
				input.itemId,
				input.decision === "approve" ? "approved" : "denied",
				input.decidedBy,
				input.note ?? null,
			],
		);
		const decided = updated.rowCount === 1;
		if (decided) {
			await boss.insert(
				RESUME_RUN_QUEUE,
				[{ data: { itemId: input.itemId, decision: input.decision } }],
				{
					db: {
						executeSql: (text: string, values?: unknown[]) =>
							client.query(text, values),
					},
				},
			);
		}
		await client.query("COMMIT");
		return decided;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Record a decision WITHOUT enqueuing a resume job — for `dev:demo`, where the
 * web head runs alone (no worker to walk the edge). The queue item resolves so
 * the UI updates; nothing downstream runs. Never used with a real worker.
 */
export async function markModerationDecided(
	db: Db,
	input: {
		itemId: string;
		decision: "approve" | "deny";
		decidedBy: string | null;
	},
): Promise<boolean> {
	const updated = await db
		.update(moderationItems)
		.set({
			status: input.decision === "approve" ? "approved" : "denied",
			decidedAt: new Date(),
			decidedBy: input.decidedBy,
		})
		.where(
			and(
				eq(moderationItems.id, input.itemId),
				eq(moderationItems.status, "pending"),
			),
		)
		.returning({ id: moderationItems.id });
	return updated.length === 1;
}

const CLOSED_CHECK_SUMMARY = `${RUN_RESULT_LABELS["closed-before-review"]}.`;

const waitingRunRow = z.object({
	id: z.string(),
	repoFullName: z.string(),
	subjectNumber: z.number(),
	actorLogin: z.string().nullable(),
	forge: forgeSchema.catch("github"),
});

const postedCheckSchema = z.object({
	sha: z.string(),
	detailsUrl: z.string(),
});

export type ClosedCheckPayload = {
	sha: string;
	conclusion: "neutral";
	summary: string;
	detailsUrl: string;
};

export type ClosedCommentPayload = {
	number: number;
	verdict: "needs_review";
	previousVerdict: "needs_review";
	body: string;
	onlyIfPresent: true;
};

export interface ClosedReview {
	runId: string;
	repoFullName: string;
	subjectNumber: number;
	check: { id: string; kind: "set-check"; payload: ClosedCheckPayload } | null;
	comment: {
		id: string;
		kind: "comment";
		payload: ClosedCommentPayload;
	} | null;
}

export async function closeReviewsForChangeRequest(
	db: Db,
	appUrl: string,
	repoFullName: string,
	subjectNumber: number,
): Promise<ClosedReview[]> {
	return await closeWaitingRuns(
		db,
		appUrl,
		sql`r.repo_full_name = ${repoFullName} AND r.subject_number = ${subjectNumber}`,
	);
}

export async function closeReviewsOfClosedChangeRequests(
	db: Db,
	appUrl: string,
): Promise<ClosedReview[]> {
	return await closeWaitingRuns(
		db,
		appUrl,
		sql`r.subject_number IS NOT NULL AND (
			SELECT e.kind FROM events e
			WHERE e.repo_full_name = r.repo_full_name
			  AND e.subject_number = r.subject_number
			  AND e.kind IN (${sql.join(
					VERDICT_EVENT_KINDS.map((kind) => sql`${kind}`),
					sql`, `,
				)})
			ORDER BY e.received_at DESC, e.id DESC
			LIMIT 1
		) = 'change-request.closed'`,
	);
}

async function closeWaitingRuns(
	db: Db,
	appUrl: string,
	scope: SQL,
): Promise<ClosedReview[]> {
	const waiting = z.array(waitingRunRow).parse(
		(
			await db.execute(sql`
				SELECT r.id, r.repo_full_name AS "repoFullName",
				       r.subject_number AS "subjectNumber",
				       e.actor_login AS "actorLogin", e.forge
				FROM runs r
				LEFT JOIN events e ON e.id = r.event_id
				WHERE r.status = 'paused' AND ${scope}
			`)
		).rows,
	);
	if (waiting.length === 0) {
		return [];
	}
	const ids = waiting.map((run) => run.id);
	await db
		.update(moderationItems)
		.set({ status: "closed", decidedAt: new Date() })
		.where(
			and(
				eq(moderationItems.status, "pending"),
				inArray(moderationItems.runId, ids),
			),
		);
	const closed = z.array(z.object({ id: z.string() })).parse(
		(
			await db.execute(sql`
				UPDATE runs r SET status = 'closed', completed_at = now()
				WHERE r.status = 'paused'
				  AND r.id IN (${sql.join(
						ids.map((id) => sql`${id}`),
						sql`, `,
					)})
				  AND NOT EXISTS (
				    SELECT 1 FROM moderation_items m
				    WHERE m.run_id = r.id AND m.status <> 'closed'
				  )
				RETURNING r.id
			`)
		).rows,
	);
	const out: ClosedReview[] = [];
	for (const run of waiting) {
		if (!closed.some((row) => row.id === run.id)) {
			continue;
		}
		const latestId = await getLatestRunIdForChangeRequest(
			db,
			run.repoFullName,
			run.subjectNumber,
		);
		out.push({
			runId: run.id,
			repoFullName: run.repoFullName,
			subjectNumber: run.subjectNumber,
			check: await closedCheck(db, run, latestId),
			comment:
				latestId === run.id ? await closedComment(db, appUrl, run) : null,
		});
	}
	return out;
}

async function closedComment(
	db: Db,
	appUrl: string,
	run: z.infer<typeof waitingRunRow>,
): Promise<ClosedReview["comment"]> {
	const repo = await getRepoByFullName(db, run.repoFullName, run.forge);
	const config = await getResponseConfig(db, repo?.id ?? null);
	const payload: ClosedCommentPayload = {
		number: run.subjectNumber,
		verdict: "needs_review",
		previousVerdict: "needs_review",
		body: renderClosedBeforeReviewComment({
			contributorLogin: run.actorLogin,
			runUrl: `${appUrl}/runs/${run.id}`,
			showRunLink: config.reviewComment.showDetailsButton,
		}),
		onlyIfPresent: true,
	};
	const [row] = await recordActions(db, run.id, [
		{
			kind: "comment",
			payload,
			idempotencyKey: `comment:${run.subjectNumber}:closed`,
		},
	]);
	return row ? { id: row.id, kind: "comment", payload } : null;
}

async function closedCheck(
	db: Db,
	run: z.infer<typeof waitingRunRow>,
	latestId: string | null,
): Promise<ClosedReview["check"]> {
	const [posted] = await db
		.select({ payload: runActions.payload })
		.from(runActions)
		.where(
			and(
				eq(runActions.runId, run.id),
				eq(runActions.kind, "set-check"),
				ne(runActions.status, "superseded"),
			),
		)
		.orderBy(desc(runActions.recordedAt))
		.limit(1);
	const check = postedCheckSchema.safeParse(posted?.payload);
	if (!check.success) {
		return null;
	}
	const latest =
		latestId && latestId !== run.id ? await getRunById(db, latestId) : null;
	if (latest?.headSha === check.data.sha) {
		return null;
	}
	const payload: ClosedCheckPayload = {
		sha: check.data.sha,
		conclusion: "neutral",
		summary: CLOSED_CHECK_SUMMARY,
		detailsUrl: check.data.detailsUrl,
	};
	const [row] = await recordActions(db, run.id, [
		{
			kind: "set-check",
			payload,
			idempotencyKey: `check:${check.data.sha}:closed`,
		},
	]);
	return row ? { id: row.id, kind: "set-check", payload } : null;
}

export async function getModerationItem(db: Db, itemId: string) {
	const rows = await db
		.select()
		.from(moderationItems)
		.where(eq(moderationItems.id, itemId));
	return rows[0] ?? null;
}

export async function listModerationItemsForRun(db: Db, runId: string) {
	return await db
		.select()
		.from(moderationItems)
		.where(eq(moderationItems.runId, runId))
		.orderBy(moderationItems.createdAt);
}

export type ModerationDecision = "approve" | "deny";

export type DecideResult =
	| { ok: true }
	| { ok: false; reason: "already-decided" | "closed" };

export async function decideRepoModerationItem(
	db: Db,
	queue: { pool: Pool; boss: PgBoss } | null,
	input: {
		repoFullName: string;
		itemId: string;
		decision: ModerationDecision;
		decidedBy: string | null;
	},
): Promise<"not-found" | DecideResult> {
	const owned = await db
		.select({ id: moderationItems.id })
		.from(moderationItems)
		.innerJoin(runs, eq(runs.id, moderationItems.runId))
		.where(
			and(
				eq(moderationItems.id, input.itemId),
				eq(runs.repoFullName, input.repoFullName),
			),
		)
		.limit(1);
	if (!owned[0]) {
		return "not-found";
	}
	const decision = {
		itemId: input.itemId,
		decision: input.decision,
		decidedBy: input.decidedBy,
	};
	const decided = queue
		? await decideModerationItem(queue.pool, queue.boss, decision)
		: await markModerationDecided(db, decision);
	if (decided) {
		return { ok: true };
	}
	const item = await getModerationItem(db, input.itemId);
	return {
		ok: false,
		reason: item?.status === "closed" ? "closed" : "already-decided",
	};
}
