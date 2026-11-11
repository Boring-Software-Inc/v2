import { restoreContributionAppealJobSchema } from "@tripwire/contracts";
import type { PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { RESTORE_CONTRIBUTION_APPEAL_QUEUE } from "../queue.ts";

export async function enqueueContributionAppealRestoration(
	client: PoolClient,
	boss: PgBoss,
	appealId: string,
): Promise<void> {
	const data = restoreContributionAppealJobSchema.parse({ appealId });
	await boss.insert(RESTORE_CONTRIBUTION_APPEAL_QUEUE, [{ data }], {
		db: { executeSql: (text, values) => client.query(text, values) },
	});
}
