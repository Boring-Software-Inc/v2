import { createServerFn } from "@tanstack/react-start";
import type { OrgWithRole } from "@tripwire/db";
import type { ModStats } from "#/lib/moderation.types";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

const ZERO_SERIES = () => Array.from({ length: 24 }, () => 0);
const ZERO_STAT = () => ({ value: 0, delta: 0, series: ZERO_SERIES() });
/** A freshly-installed repo with no runs yet — honest zeros, not a spinner. */
const ZERO_STATS = (): ModStats => ({
	sentToReview: ZERO_STAT(),
	blocked: ZERO_STAT(),
	passed: ZERO_STAT(),
});

// The home stat cards are REAL — rollup-backed via insights (§13.10), scoped to
// the active repo (§10). A DB error surfaces honestly (the caller renders an
// error state); there is NO mock fallback — fabricated numbers are worse than a
// visible failure.
export const getModerationStats = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("analytics:read"),
	])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<ModStats> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo).catch(() => null);
		if (!repo) {
			return ZERO_STATS();
		}
		const { insightServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await insightServices.getHomeStats(getDb().db, repo);
	});
