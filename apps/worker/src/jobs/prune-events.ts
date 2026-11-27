import { type Db, eventServices } from "@tripwire/db";
import type { Logger } from "pino";

export const PRUNE_EVENTS_QUEUE = "prune-events";
export const PRUNE_EVENTS_CRON = "40 3 * * *";

export interface PruneEventsDeps {
	db: Db;
	logger: Logger;
	/** `EVENT_RETENTION_DAYS`; unset leaves every event in place. */
	retentionDays: string | undefined;
}

/**
 * Off until `EVENT_RETENTION_DAYS` is set, so turning retention on for an
 * environment is a deliberate choice: the first run there deletes most of its
 * event history. Values under 30 days are refused, since backfill and rule
 * previews read 30 days back.
 */
export function eventRetentionDays(value: string | undefined): number | null {
	if (!value) return null;
	const days = Number(value);
	return Number.isInteger(days) &&
		days >= eventServices.MIN_EVENT_RETENTION_DAYS
		? days
		: null;
}

export async function pruneEvents(deps: PruneEventsDeps): Promise<number> {
	const days = eventRetentionDays(deps.retentionDays);
	if (days === null) {
		if (deps.retentionDays)
			deps.logger.warn(
				{
					value: deps.retentionDays,
					minimum: eventServices.MIN_EVENT_RETENTION_DAYS,
				},
				"EVENT_RETENTION_DAYS is not a whole number of days at or above the minimum; events kept",
			);
		return 0;
	}
	const removed = await eventServices.pruneEvents(deps.db, {
		olderThanDays: days,
	});
	deps.logger.info({ removed, olderThanDays: days }, "old events pruned");
	return removed;
}
