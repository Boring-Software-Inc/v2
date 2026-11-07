import {
	type Forge,
	INSTALL_ACCESS_CHECK_TTL_SECONDS,
	type InstallAccessResult,
	installAccessResultSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { installationAccessChecks } from "../schema/organizations.ts";

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
	db: Db,
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

/**
 * Count a user's access-check rows newer than `windowSeconds` — the per-user
 * rate-limit probe for `recoverInstallation`. Counts distinct installation ids
 * (the upsert on `(user_id, forge, installation_id)` collapses repeats of the
 * same id), which is exactly the dimension an attacker rotates to burn quota.
 */
export async function countRecentInstallAccessChecks(
	db: Db,
	userId: string,
	windowSeconds: number,
): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(installationAccessChecks)
		.where(
			and(
				eq(installationAccessChecks.userId, userId),
				gt(
					installationAccessChecks.verifiedAt,
					sql`now() - make_interval(secs => ${windowSeconds})`,
				),
			),
		);
	return rows[0]?.count ?? 0;
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
