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

export const SWEEP_FLAG_REMOVALS_QUEUE = "sweep-flag-removals";
export const SWEEP_FLAG_REMOVALS_CRON = "*/10 * * * *";
export const FLAG_REMOVAL_GRACE_MS = 5 * 60 * 1000;

export interface SweepFlagRemovalsDeps {
	db: Db;
	enqueue: (flagKey: string) => Promise<void>;
	logger: Logger;
}

export async function sweepFlagRemovals(
	deps: SweepFlagRemovalsDeps,
	now = new Date(),
): Promise<string[]> {
	const flagKeys = await flagOverrideServices.listPendingFlagRemovals(
		deps.db,
		new Date(now.getTime() - FLAG_REMOVAL_GRACE_MS),
	);
	for (const flagKey of flagKeys) {
		await deps.enqueue(flagKey);
	}
	if (flagKeys.length > 0) {
		deps.logger.info({ flagKeys }, "flag removals queued for sync");
	}
	return flagKeys;
}
