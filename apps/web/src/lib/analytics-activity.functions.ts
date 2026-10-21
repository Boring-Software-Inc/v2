import { createServerFn } from "@tanstack/react-start";
import type { OrgWithRole } from "@tripwire/db";
import type { AnalyticsEvent } from "#/lib/analytics-events";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgMemberMiddleware, resolveOrgRepo } from "#/lib/server/org-guard";

/**
 * Real activity behind a moderation metric — the list under the chart on
 * `/analytics`. Each metric surfaces the runs/decisions that actually moved
 * its line, built from the runs + moderation_items tables (the same sources
 * the chart series come from), so chart and activity tell one story.
 */

function subject(subjectNumber: number | null): string {
	return subjectNumber ? `#${subjectNumber}` : "Change request";
}

function actor(actorLogin: string | null): string {
	return actorLogin ?? "Unknown contributor";
}

export const getAnalyticsActivity = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator(
		(input: { org: string; repo: string; metric: string }) => input,
	)
	.handler(async ({ data, context }): Promise<AnalyticsEvent[]> => {
		const org = (context as { org: OrgWithRole }).org;
		const scoped = await resolveOrgRepo(org.id, data.repo);
		const { insightServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const { db } = getDb();

		if (data.metric === "blocked") {
			const runs = await insightServices.listRecentRuns(db, {
				verdicts: ["block"],
				repoFullName: scoped.fullName,
			});
			return runs.map((r) => ({
				id: r.runId,
				kind: "ban",
				title: actor(r.actorLogin),
				detail: subject(r.subjectNumber),
				at: r.createdAt.toISOString(),
				impact: {
					label: `${r.failedCount} of ${r.ruleCount} ${r.ruleCount === 1 ? "rule" : "rules"} tripped`,
					tone: "neutral",
				},
			}));
		}

		if (data.metric === "passed") {
			const runs = await insightServices.listRecentRuns(db, {
				verdicts: ["pass"],
				repoFullName: scoped.fullName,
			});
			return runs.map((r) => ({
				id: r.runId,
				kind: "resolve",
				title: actor(r.actorLogin),
				detail: subject(r.subjectNumber),
				at: r.createdAt.toISOString(),
			}));
		}

		// "review" (default): runs awaiting a maintainer's decision.
		const runs = await insightServices.listRecentRuns(db, {
			verdicts: ["needs_review"],
			repoFullName: scoped.fullName,
		});
		return runs.map((r) => ({
			id: r.runId,
			kind: "report",
			title: actor(r.actorLogin),
			detail: subject(r.subjectNumber),
			at: r.createdAt.toISOString(),
		}));
	});
