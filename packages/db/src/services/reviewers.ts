import {
	type GitCafeRepoReviewer,
	gitCafeRepoReviewerSchema,
	githubRepoReviewerSchema,
	type RepoReviewer,
	repoSuggestionValuesSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, asc, eq, max, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	repoReviewers,
	repoSuggestions,
	repoSyncStamps,
	repos,
} from "../schema/repos.ts";
import type { DbLike } from "./access.ts";
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
	const [repo] = await db
		.select({ forge: repos.forge })
		.from(repos)
		.where(eq(repos.id, repoId));
	if (repo?.forge === "gitcafe") {
		const [cached] = await db
			.select()
			.from(repoSuggestions)
			.where(
				sql`${repoSuggestions.repoId} = ${repoId} AND ${repoSuggestions.kind} = 'reviewers'`,
			);
		const values = repoSuggestionValuesSchema.parse(cached?.values ?? []);
		return {
			reviewers: values.map((value) => gitCafeRepoReviewerSchema.parse(value)),
			syncedAt: cached?.updatedAt ?? null,
		};
	}
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
			const parsed = githubRepoReviewerSchema.parse(reviewer);
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

/** GitCafe candidates use the existing typed suggestion cache; GitHub numeric IDs retain their table. */
export async function replaceGitCafeReviewerSuggestions(
	db: DbLike,
	repoId: string,
	reviewers: readonly RepoReviewer[],
): Promise<void> {
	const unique = new Map<string, GitCafeRepoReviewer>();
	for (const value of reviewers) {
		const reviewer = gitCafeRepoReviewerSchema.parse(value);
		unique.set(reviewer.id, reviewer);
	}
	const values = repoSuggestionValuesSchema.parse(
		[...unique.values()].sort((a, b) => a.login.localeCompare(b.login)),
	);
	await db
		.insert(repoSuggestions)
		.values({
			id: generateId(),
			repoId,
			kind: "reviewers",
			values,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [repoSuggestions.repoId, repoSuggestions.kind],
			set: { values, updatedAt: new Date() },
		});
}

export async function lastReviewerSync(
	db: Db,
	repoId: string,
): Promise<Date | null> {
	return reviewerSyncedAt(db, repoId);
}
