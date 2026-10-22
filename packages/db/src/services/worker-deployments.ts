import { eq, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { workerDeployments } from "../schema/workers.ts";

export interface WorkerDeploymentRow {
	deploymentId: string;
	firstSeenAt: Date;
	lastHeartbeatAt: Date;
}

export function electLeader(
	rows: readonly WorkerDeploymentRow[],
	now: Date,
	staleAfterMs: number,
): string | null {
	const cutoff = now.getTime() - staleAfterMs;
	let leader: WorkerDeploymentRow | null = null;
	for (const row of rows) {
		if (row.lastHeartbeatAt.getTime() < cutoff) {
			continue;
		}
		if (
			!leader ||
			row.firstSeenAt.getTime() > leader.firstSeenAt.getTime() ||
			(row.firstSeenAt.getTime() === leader.firstSeenAt.getTime() &&
				row.deploymentId > leader.deploymentId)
		) {
			leader = row;
		}
	}
	return leader?.deploymentId ?? null;
}

export async function heartbeat(db: Db, deploymentId: string): Promise<void> {
	await db
		.update(workerDeployments)
		.set({ lastHeartbeatAt: sql`now()` })
		.where(eq(workerDeployments.deploymentId, deploymentId));
}

export async function register(db: Db, deploymentId: string): Promise<void> {
	await db
		.insert(workerDeployments)
		.values({ deploymentId })
		.onConflictDoNothing({ target: workerDeployments.deploymentId });
	await heartbeat(db, deploymentId);
}

export async function leader(
	db: Db,
	staleAfterMs: number,
): Promise<string | null> {
	const rows = await db
		.select({
			deploymentId: workerDeployments.deploymentId,
			firstSeenAt: workerDeployments.firstSeenAt,
			lastHeartbeatAt: workerDeployments.lastHeartbeatAt,
			now: sql`now()`.mapWith(workerDeployments.lastHeartbeatAt),
		})
		.from(workerDeployments);
	const now = rows[0]?.now;
	return now ? electLeader(rows, now, staleAfterMs) : null;
}

export async function prune(db: Db, olderThanMs: number): Promise<number> {
	const removed = await db
		.delete(workerDeployments)
		.where(
			lt(
				workerDeployments.lastHeartbeatAt,
				sql`now() - make_interval(secs => ${olderThanMs / 1000})`,
			),
		)
		.returning({ deploymentId: workerDeployments.deploymentId });
	return removed.length;
}
