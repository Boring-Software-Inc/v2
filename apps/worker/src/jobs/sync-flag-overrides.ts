import type { Db, SyncFlagOverridesJob, SyncFlagResult } from "@tripwire/db";
import { flagOverrideServices } from "@tripwire/db";
import type { DatabuddyApi } from "@tripwire/utils";
import type { Logger } from "pino";

export const DATABUDDY_NOT_CONNECTED = "Databuddy is not connected.";

export interface SyncFlagOverridesDeps {
	db: Db;
	api: Pick<DatabuddyApi, "getFlagByKey" | "updateFlagRules"> | null;
	logger: Logger;
}

export class FlagSyncFailedError extends Error {
	constructor(flagKey: string, reason: string) {
		super(`flag ${flagKey} did not sync: ${reason}`);
		this.name = "FlagSyncFailedError";
	}
}

export async function syncFlagOverridesJob(
	deps: SyncFlagOverridesDeps,
	job: SyncFlagOverridesJob,
): Promise<SyncFlagResult | null> {
	const { db, api, logger } = deps;
	if (!api) {
		await flagOverrideServices.markFlagNotConnected(
			db,
			job.flagKey,
			DATABUDDY_NOT_CONNECTED,
		);
		logger.warn({ flagKey: job.flagKey }, "flag sync skipped: no api key");
		return null;
	}
	const result = await flagOverrideServices.syncFlagOverrides(
		db,
		api,
		job.flagKey,
	);
	if (result.status === "failed") {
		logger.warn(
			{ flagKey: job.flagKey, error: result.error },
			"flag sync failed: will retry",
		);
		throw new FlagSyncFailedError(job.flagKey, result.error);
	}
	logger.info({ flagKey: job.flagKey, result }, "flag overrides synced");
	return result;
}
