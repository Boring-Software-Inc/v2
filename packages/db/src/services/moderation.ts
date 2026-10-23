import { generateId } from "@tripwire/utils";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Db } from "../client.ts";
import { RESUME_RUN_QUEUE } from "../queue.ts";
import { moderationItems } from "../schema/moderation.ts";
import { runs } from "../schema/runs.ts";

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

export async function decideRepoModerationItem(
	db: Db,
	queue: { pool: Pool; boss: PgBoss } | null,
	input: {
		repoFullName: string;
		itemId: string;
		decision: ModerationDecision;
		decidedBy: string | null;
	},
): Promise<"not-found" | { ok: boolean }> {
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
	if (!queue) {
		return { ok: await markModerationDecided(db, decision) };
	}
	return {
		ok: await decideModerationItem(queue.pool, queue.boss, decision),
	};
}
