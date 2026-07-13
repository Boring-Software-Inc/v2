import { generateId } from "@tripwire/utils";
import { and, desc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Db } from "../client.ts";
import { RESUME_RUN_QUEUE } from "../queue.ts";
import { events } from "../schema/events.ts";
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

/** The moderation queue, SCOPED to the user's active repo (§10). */
export async function listPendingItems(db: Db, repoFullName: string) {
	const rows = await db
		.select({
			id: moderationItems.id,
			runId: moderationItems.runId,
			nodeId: moderationItems.nodeId,
			createdAt: moderationItems.createdAt,
			repoFullName: runs.repoFullName,
			subjectNumber: runs.subjectNumber,
			eventId: runs.eventId,
		})
		.from(moderationItems)
		.innerJoin(runs, eq(moderationItems.runId, runs.id))
		.where(
			and(
				eq(moderationItems.status, "pending"),
				eq(runs.repoFullName, repoFullName),
			),
		)
		.orderBy(desc(moderationItems.id));
	const withActors = [];
	for (const row of rows) {
		const eventRows = await db
			.select({ actorLogin: events.actorLogin })
			.from(events)
			.where(eq(events.id, row.eventId));
		withActors.push({
			...row,
			actorLogin: eventRows[0]?.actorLogin ?? null,
		});
	}
	return withActors;
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
