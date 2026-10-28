import { createServerFn } from "@tanstack/react-start";
import type { OrgWithRole } from "@tripwire/db";
import type { DateRange } from "#/lib/date-range";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgPermissionMiddleware } from "#/lib/server/org-guard";

/**
 * Real activity behind a moderation metric — the list under the chart on
 * `/analytics`. Each metric surfaces the runs/decisions that actually moved
 * its line, built from the runs + moderation_items tables (the same sources
 * the chart series come from), so chart and activity tell one story.
 */

export const getAnalyticsActivity = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("analytics:read"),
	])
	.inputValidator(
		(input: {
			org: string;
			repo: string;
			metric: string;
			range?: DateRange | null;
		}) => input,
	)
	.handler(async ({ data, context }) => {
		const { analyticsActivityHandler } = await import(
			"#/lib/server/analytics-activity"
		);
		return analyticsActivityHandler({
			data,
			context: { org: (context as { org: OrgWithRole }).org },
		});
	});
