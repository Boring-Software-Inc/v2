import {
	type GitCafeRepoReviewer,
	gitCafeRepoReviewerSchema,
	githubRepoReviewerSchema,
	type RepoReviewer,
	repoSuggestionValuesSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { asc, eq, max, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { repoReviewers, repoSuggestions, repos } from "../schema/repos.ts";
import type { DbLike } from "./access.ts";
import { syncIsStale } from "./sync-age.ts";

export interface RepoReviewerList {
	reviewers: RepoReviewer[];
	syncedAt: Date | null;
}

export const REVIEWER_SYNC_STALE_MS = 24 * 60 * 60_000;

export function reviewersNeedSync(syncedAt: Date | null, now: Date): boolean {
	return syncIsStale(syncedAt, now, REVIEWER_SYNC_STALE_MS);
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
	const rows = await db
		.select()
		.from(repoReviewers)
		.where(eq(repoReviewers.repoId, repoId))
		.orderBy(asc(sql`lower(${repoReviewers.login})`));
	const syncedAt = rows.reduce<Date | null>(
		(latest, row) => (latest && latest > row.syncedAt ? latest : row.syncedAt),
		null,
	);
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
	const rows = await db
		.select({ syncedAt: max(repoReviewers.syncedAt) })
		.from(repoReviewers)
		.where(eq(repoReviewers.repoId, repoId));
	return rows[0]?.syncedAt ?? null;
}
