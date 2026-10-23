import { type RepoLabel, repoLabelSchema } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { repoLabels } from "../schema/repos.ts";
import { syncIsStale } from "./sync-age.ts";

export interface RepoLabelList {
	labels: RepoLabel[];
	syncedAt: Date | null;
}

export const LABEL_SYNC_STALE_MS = 60_000;

export function labelsNeedSync(syncedAt: Date | null, now: Date): boolean {
	return syncIsStale(syncedAt, now, LABEL_SYNC_STALE_MS);
}

export async function listRepoLabels(
	db: Db,
	repoId: string,
): Promise<RepoLabelList> {
	const rows = await db
		.select()
		.from(repoLabels)
		.where(eq(repoLabels.repoId, repoId))
		.orderBy(asc(sql`lower(${repoLabels.name})`));
	const syncedAt = rows.reduce<Date | null>(
		(latest, row) => (latest && latest > row.syncedAt ? latest : row.syncedAt),
		null,
	);
	return {
		labels: rows.map((row) => ({
			name: row.name,
			color: row.color,
			description: row.description,
		})),
		syncedAt,
	};
}

export async function replaceRepoLabels(
	db: Db,
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
