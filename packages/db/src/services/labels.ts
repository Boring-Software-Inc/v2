import { type RepoLabel, repoLabelSchema } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, asc, eq, max, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { repoLabels, repoSyncStamps } from "../schema/repos.ts";
import type { DbLike } from "./access.ts";
import { syncIsStale } from "./sync-age.ts";

export interface RepoLabelList {
	labels: RepoLabel[];
	syncedAt: Date | null;
}

export const LABEL_SYNC_STALE_MS = 60_000;

export const LABEL_SYNC_KIND = "labels";

export function labelsNeedSync(syncedAt: Date | null, now: Date): boolean {
	return syncIsStale(syncedAt, now, LABEL_SYNC_STALE_MS);
}

/**
 * The sync stamp for a repo's label cache — `max(stamp, max(row.synced_at))`.
 * The stamp survives an empty result (zero labels), which the per-row
 * `synced_at` cannot: a successful sync to empty still makes the repo fresh for
 * the stale window.
 */
async function labelSyncedAt(db: Db, repoId: string): Promise<Date | null> {
	const [stampRow, rowMax] = await Promise.all([
		db
			.select({ syncedAt: repoSyncStamps.syncedAt })
			.from(repoSyncStamps)
			.where(
				and(
					eq(repoSyncStamps.repoId, repoId),
					eq(repoSyncStamps.kind, LABEL_SYNC_KIND),
				),
			)
			.limit(1),
		db
			.select({ syncedAt: max(repoLabels.syncedAt) })
			.from(repoLabels)
			.where(eq(repoLabels.repoId, repoId)),
	]);
	const stamp = stampRow[0]?.syncedAt ?? null;
	const rows = rowMax[0]?.syncedAt ?? null;
	if (stamp && rows) {
		return stamp > rows ? stamp : rows;
	}
	return stamp ?? rows;
}

export async function listRepoLabels(
	db: Db,
	repoId: string,
): Promise<RepoLabelList> {
	const [rows, syncedAt] = await Promise.all([
		db
			.select()
			.from(repoLabels)
			.where(eq(repoLabels.repoId, repoId))
			.orderBy(asc(sql`lower(${repoLabels.name})`)),
		labelSyncedAt(db, repoId),
	]);
	return {
		labels: rows.map((row) => ({
			name: row.name,
			color: row.color,
			description: row.description,
		})),
		syncedAt,
	};
}

/**
 * Unconditionally record a sync stamp for a repo's label cache — even when the
 * result set is empty (or the sync was skipped because GitHub reads are
 * disabled). Without this, a zero-label sync leaves `syncedAt` null forever and
 * every read re-queues a sync, defeating the staleness throttle.
 */
export async function stampRepoLabelSync(
	db: Db,
	repoId: string,
	syncedAt: Date = new Date(),
): Promise<void> {
	await db
		.insert(repoSyncStamps)
		.values({ repoId, kind: LABEL_SYNC_KIND, syncedAt })
		.onConflictDoUpdate({
			target: [repoSyncStamps.repoId, repoSyncStamps.kind],
			set: { syncedAt },
		});
}

export async function replaceRepoLabels(
	db: DbLike,
	repoId: string,
	labels: readonly RepoLabel[],
	syncedAt: Date = new Date(),
): Promise<void> {
	const unique = new Map(
		labels.map((label) => {
			const parsed = repoLabelSchema.parse(label);
			return [parsed.name, parsed];
		}),
	);
	await db.transaction(async (tx) => {
		await tx.delete(repoLabels).where(eq(repoLabels.repoId, repoId));
		await tx
			.insert(repoSyncStamps)
			.values({ repoId, kind: LABEL_SYNC_KIND, syncedAt })
			.onConflictDoUpdate({
				target: [repoSyncStamps.repoId, repoSyncStamps.kind],
				set: { syncedAt },
			});
		if (unique.size === 0) {
			return;
		}
		await tx.insert(repoLabels).values(
			[...unique.values()].map((label) => ({
				id: generateId(),
				repoId,
				name: label.name,
				color: label.color.toLowerCase(),
				description: label.description,
				syncedAt,
			})),
		);
	});
}
