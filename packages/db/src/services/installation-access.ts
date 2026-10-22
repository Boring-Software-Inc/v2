import {
	type Forge,
	INSTALL_ACCESS_CHECK_TTL_SECONDS,
	type InstallAccessResult,
	installAccessResultSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, gt, sql } from "drizzle-orm";
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
