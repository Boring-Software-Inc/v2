import { type RepoReviewer, repoReviewerSchema } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { asc, eq, max, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { repoReviewers } from "../schema/repos.ts";

export interface RepoReviewerList {
	reviewers: RepoReviewer[];
	syncedAt: Date | null;
}

export async function listRepoReviewers(
	db: Db,
	repoId: string,
): Promise<RepoReviewerList> {
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
			const parsed = repoReviewerSchema.parse(reviewer);
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
