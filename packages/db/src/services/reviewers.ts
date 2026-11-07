import { type RepoReviewer, repoReviewerSchema } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, asc, eq, max, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { repoReviewers, repoSyncStamps } from "../schema/repos.ts";
import { syncIsStale } from "./sync-age.ts";

export interface RepoReviewerList {
	reviewers: RepoReviewer[];
	syncedAt: Date | null;
}

export const REVIEWER_SYNC_STALE_MS = 24 * 60 * 60_000;

export const REVIEWER_SYNC_KIND = "reviewers";

export function reviewersNeedSync(syncedAt: Date | null, now: Date): boolean {
	return syncIsStale(syncedAt, now, REVIEWER_SYNC_STALE_MS);
}

/**
 * The sync stamp for a repo's reviewer cache — `max(stamp, max(row.synced_at))`.
 * The stamp survives an empty result (zero reviewers), which the per-row
 * `synced_at` cannot: a successful sync to empty still makes the repo fresh for
 * the stale window.
 */
async function reviewerSyncedAt(db: Db, repoId: string): Promise<Date | null> {
	const [stampRow, rowMax] = await Promise.all([
		db
			.select({ syncedAt: repoSyncStamps.syncedAt })
			.from(repoSyncStamps)
			.where(
				and(
					eq(repoSyncStamps.repoId, repoId),
					eq(repoSyncStamps.kind, REVIEWER_SYNC_KIND),
				),
			)
			.limit(1),
		db
			.select({ syncedAt: max(repoReviewers.syncedAt) })
			.from(repoReviewers)
			.where(eq(repoReviewers.repoId, repoId)),
	]);
	const stamp = stampRow[0]?.syncedAt ?? null;
	const rows = rowMax[0]?.syncedAt ?? null;
	if (stamp && rows) {
		return stamp > rows ? stamp : rows;
	}
	return stamp ?? rows;
}

export async function listRepoReviewers(
	db: Db,
	repoId: string,
): Promise<RepoReviewerList> {
	const [rows, syncedAt] = await Promise.all([
		db
			.select()
			.from(repoReviewers)
			.where(eq(repoReviewers.repoId, repoId))
			.orderBy(asc(sql`lower(${repoReviewers.login})`)),
		reviewerSyncedAt(db, repoId),
	]);
	return {
		reviewers: rows.map((row) => ({
			id: row.githubUserId,
			login: row.login,
			avatarUrl: row.avatarUrl,
			permission: row.permission,
		})),
		syncedAt,
	};
}

/**
 * Unconditionally record a sync stamp for a repo — even when the result set is
 * empty (or the sync was skipped because GitHub reads are disabled). Without
 * this, a zero-reviewer sync leaves `syncedAt` null forever and every read
 * re-queues a sync, defeating the 24-hour staleness throttle.
 */
export async function stampRepoReviewerSync(
	db: Db,
	repoId: string,
	syncedAt: Date = new Date(),
): Promise<void> {
	await db
		.insert(repoSyncStamps)
		.values({ repoId, kind: REVIEWER_SYNC_KIND, syncedAt })
		.onConflictDoUpdate({
			target: [repoSyncStamps.repoId, repoSyncStamps.kind],
			set: { syncedAt },
		});
}

export async function replaceRepoReviewers(
	db: Db,
	repoId: string,
	reviewers: readonly RepoReviewer[],
	syncedAt: Date = new Date(),
): Promise<void> {
	const unique = new Map(
		reviewers.map((reviewer) => {
			const parsed = repoReviewerSchema.parse(reviewer);
			return [parsed.id, parsed];
		}),
	);
	await db.transaction(async (tx) => {
		await tx.delete(repoReviewers).where(eq(repoReviewers.repoId, repoId));
		await tx
			.insert(repoSyncStamps)
			.values({ repoId, kind: REVIEWER_SYNC_KIND, syncedAt })
			.onConflictDoUpdate({
				target: [repoSyncStamps.repoId, repoSyncStamps.kind],
				set: { syncedAt },
			});
		if (unique.size === 0) {
			return;
		}
		await tx.insert(repoReviewers).values(
			[...unique.values()].map((reviewer) => ({
				id: generateId(),
				repoId,
				githubUserId: reviewer.id,
				login: reviewer.login,
				avatarUrl: reviewer.avatarUrl,
				permission: reviewer.permission,
				syncedAt,
			})),
		);
	});
}

export async function lastReviewerSync(
	db: Db,
	repoId: string,
): Promise<Date | null> {
	return reviewerSyncedAt(db, repoId);
}
