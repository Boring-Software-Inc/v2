import { INSTALL_ACCESS_CHECK_RETENTION_DAYS } from "@tripwire/contracts";
import { type Db, installationAccessServices } from "@tripwire/db";
import type { Logger } from "pino";

export const PRUNE_INSTALLATION_ACCESS_CHECKS_QUEUE =
	"prune-installation-access-checks";
export const PRUNE_INSTALLATION_ACCESS_CHECKS_CRON = "30 3 * * *";

export interface PruneInstallationAccessChecksDeps {
	db: Db;
	logger: Logger;
}

/**
 * Daily retention prune for `installation_access_checks`. Without this the
 * table grows indefinitely — the only other deletion path is the
 * `ON DELETE CASCADE` FK on user deletion. Rows older than the retention
 * window are deleted; the freshness TTL (`INSTALL_ACCESS_CHECK_TTL_SECONDS`)
 * only governs SELECT filters, never pruning.
 */
export async function pruneInstallationAccessChecks(
	deps: PruneInstallationAccessChecksDeps,
): Promise<number> {
	const removed = await installationAccessServices.pruneInstallAccessChecks(
		deps.db,
		INSTALL_ACCESS_CHECK_RETENTION_DAYS,
	);
	deps.logger.info(
		{ removed, maxAgeDays: INSTALL_ACCESS_CHECK_RETENTION_DAYS },
		"installation access checks pruned",
	);
	return removed;
}
