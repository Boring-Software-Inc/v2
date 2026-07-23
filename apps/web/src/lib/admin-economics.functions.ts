import { createServerFn } from "@tanstack/react-start";
import type {
	CostByOrgRow,
	EconomicsDayPoint,
	EconomicsOverview,
	RailwayBreakdown,
} from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { platformAdminMiddleware } from "#/lib/server/staff-guard";

export type {
	CostByOrgRow,
	EconomicsDayPoint,
	EconomicsOverview,
	RailwayBreakdown,
};

/**
 * Platform staff economics surface (/admin/economics). Every fn is class "staff":
 * accessGuard + platformAdminMiddleware, denial always 404. Reads are thin
 * wrappers over economicsServices — this page shows platform-wide cost data, so
 * it reuses the SAME gate as the rest of /admin. No new auth logic.
 */

/** The current UTC month as YYYY-MM. Server code in apps/web runs on Node. */
function currentUtcMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

const ECONOMICS_SERIES_DAYS = 30;

export const getEconomicsOverview = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.handler(async (): Promise<EconomicsOverview> => {
		const { getDb } = await import("#/lib/server/db");
		const { economicsServices } = await import("@tripwire/db");
		return economicsServices.getEconomicsOverview(
			getDb().db,
			currentUtcMonth(),
		);
	});

export const getEconomicsSeries = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.handler(async (): Promise<EconomicsDayPoint[]> => {
		const { getDb } = await import("#/lib/server/db");
		const { economicsServices } = await import("@tripwire/db");
		return economicsServices.getEconomicsSeries(
			getDb().db,
			ECONOMICS_SERIES_DAYS,
		);
	});

export const getCostByOrg = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.handler(async (): Promise<CostByOrgRow[]> => {
		const { getDb } = await import("#/lib/server/db");
		const { economicsServices } = await import("@tripwire/db");
		return economicsServices.getCostByOrg(getDb().db, currentUtcMonth());
	});

export const getRailwayBreakdown = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, platformAdminMiddleware])
	.handler(async (): Promise<RailwayBreakdown | null> => {
		const { getDb } = await import("#/lib/server/db");
		const { economicsServices } = await import("@tripwire/db");
		return economicsServices.getRailwayBreakdown(getDb().db);
	});
