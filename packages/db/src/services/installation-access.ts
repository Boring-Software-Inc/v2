import {
	type Forge,
	INSTALL_ACCESS_CHECK_TTL_SECONDS,
	type InstallAccessResult,
	installAccessResultSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgBoss } from "pg-boss";
import { type Db, requirePostgresPool, schema } from "../client.ts";
import {
	RECOVER_INSTALLATION_QUEUE,
	type RecoverInstallationJob,
	recoverInstallationOptions,
} from "../queue.ts";
import { installationAccessChecks } from "../schema/organizations.ts";

const RECOVERY_WINDOW_SECONDS = 60;
const MAX_RECENT_RECOVERIES = 5;

type AccessCheckWriter = Pick<Db, "insert">;

export interface InstallAccessCheck {
	result: InstallAccessResult;
	verifiedAt: Date;
}

export interface InstallAccessKey {
	userId: string;
	forge: Forge;
	installationId: string;
}

export async function recordInstallAccessCheck(
	db: AccessCheckWriter,
	input: InstallAccessKey & { result: InstallAccessResult; at?: Date },
): Promise<void> {
	const result = installAccessResultSchema.parse(input.result);
	const verifiedAt = input.at ?? new Date();
	await db
		.insert(installationAccessChecks)
		.values({
			id: generateId(),
			userId: input.userId,
			forge: input.forge,
			installationId: input.installationId,
			result,
			verifiedAt,
		})
		.onConflictDoUpdate({
			target: [
				installationAccessChecks.userId,
				installationAccessChecks.forge,
				installationAccessChecks.installationId,
			],
			set: { result, verifiedAt },
		});
}

export async function getFreshInstallAccessCheck(
	db: Db,
	input: InstallAccessKey,
): Promise<InstallAccessCheck | null> {
	const rows = await db
		.select({
			result: installationAccessChecks.result,
			verifiedAt: installationAccessChecks.verifiedAt,
		})
		.from(installationAccessChecks)
		.where(
			and(
				eq(installationAccessChecks.userId, input.userId),
				eq(installationAccessChecks.forge, input.forge),
				eq(installationAccessChecks.installationId, input.installationId),
				gt(
					installationAccessChecks.verifiedAt,
					sql`now() - make_interval(secs => ${INSTALL_ACCESS_CHECK_TTL_SECONDS})`,
				),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

/** Serialize requests per user so simultaneous attempts share the same budget. */
export async function requestInstallationRecovery(
	db: Db,
	boss: Pick<PgBoss, "send">,
	job: RecoverInstallationJob,
): Promise<"queued" | "already-requested" | "rate-limited"> {
	const client = await requirePostgresPool(db).connect();
	try {
		return await drizzle(client, { schema }).transaction(async (tx) => {
			const lockKey = `installation-recovery:${job.userId}`;
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
			);
			const recent = await tx
				.select({ installationId: installationAccessChecks.installationId })
				.from(installationAccessChecks)
				.where(
					and(
						eq(installationAccessChecks.userId, job.userId),
						eq(installationAccessChecks.forge, "github"),
						gt(
							installationAccessChecks.verifiedAt,
							sql`now() - make_interval(secs => ${RECOVERY_WINDOW_SECONDS})`,
						),
					),
				);
			if (recent.some((row) => row.installationId === job.installationId)) {
				return "already-requested";
			}
			if (recent.length >= MAX_RECENT_RECOVERIES) {
				return "rate-limited";
			}
			const id = await boss.send(RECOVER_INSTALLATION_QUEUE, job, {
				...recoverInstallationOptions(job),
				db: { executeSql: (text, values) => client.query(text, values) },
			});
			if (id === null) {
				return "already-requested";
			}
			await recordInstallAccessCheck(tx, {
				...job,
				forge: "github",
				result: "pending",
			});
			return "queued";
		});
	} finally {
		client.release();
	}
}

/**
 * Delete access-check rows older than `maxAgeDays` — the scheduled retention
 * prune. Without this, the table grows indefinitely: the only other deletion
 * path is the `ON DELETE CASCADE` FK on user deletion.
 */
export async function pruneInstallAccessChecks(
	db: Db,
	maxAgeDays: number,
): Promise<number> {
	const removed = await db
		.delete(installationAccessChecks)
		.where(
			lt(
				installationAccessChecks.verifiedAt,
				sql`now() - make_interval(secs => ${maxAgeDays * 24 * 60 * 60})`,
			),
		)
		.returning({ id: installationAccessChecks.id });
	return removed.length;
}
