import type { Db } from "@tripwire/db";
import { economicsServices } from "@tripwire/db";
import type { Logger } from "pino";
import { previousUtcDay } from "./pull-provider-costs.ts";

/**
 * economics-rollup (economics-surface-contracts.md): fold the previous UTC day's
 * raw metering into economics_daily, cross-check against the pulled invoices,
 * and decrement the credit balance. Cron 02:20 UTC, after the 01:40 pull. Thin
 * wrapper: all aggregation and reconciliation live in the service.
 */
export async function economicsRollup(deps: {
	db: Db;
	logger: Logger;
	now?: Date;
}): Promise<void> {
	const day = previousUtcDay(deps.now ?? new Date());
	const result = await economicsServices.rollupEconomicsDay(deps.db, day);
	deps.logger.info(
		{
			day: result.day,
			orgRows: result.orgRows,
			metered: result.meteredCostUsd,
			pulled: result.pulledCostUsd,
			driftPct: result.driftPct,
			creditBalance: result.creditBalanceUsd,
		},
		"economics rollup complete",
	);
}
