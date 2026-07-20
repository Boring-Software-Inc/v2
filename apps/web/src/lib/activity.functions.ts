import { createServerFn } from "@tanstack/react-start";
import {
	type ActivityFeed,
	type ActivityFeedItem,
	type ActivityGroup,
	type ActivityRunSummary,
	type ActivityTimelineEntry,
	activityFeedSchema,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

// The wire shapes live in @tripwire/contracts (one home, validated). Re-exported
// here under the names the /activity components already use.
export type ActivityRun = ActivityRunSummary;
export type ActivityItem = ActivityTimelineEntry;
export type { ActivityFeedItem, ActivityGroup };
export type ActivityFeedData = ActivityFeed;

export type RerunRequestResult =
	| { status: "queued" }
	| { status: "cooldown"; retryInSeconds: number }
	| { status: "no-workflow" }
	| { status: "not-armed" };

/**
 * Manual re-run (admin): evaluate the change request again under the CURRENT
 * enabled workflow, as a NEW run, delivered as an amendment. The enqueue uses
 * pg-boss singletonKey + singletonSeconds — one re-run per PR per cooldown
 * window; a deduped send returns null and the caller sees the cooldown.
 */
export const rerunChangeRequest = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repo: string; number: number }) => input,
	)
	.handler(async ({ data, context }): Promise<RerunRequestResult> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { repoServices, RERUN_QUEUE, RERUN_COOLDOWN_SECONDS } = await import(
			"@tripwire/db"
		);
		const { getDb, getBoss } = await import("#/lib/server/db");
		const db = getDb().db;
		if (!repo.armed) {
			return { status: "not-armed" };
		}
		const [workflows, configs] = await Promise.all([
			repoServices.listEnabledWorkflows(db, repo.fullName),
			repoServices.listRuleConfigs(db, repo.id),
		]);
		if (workflows.length === 0 && !configs.some((config) => config.enabled)) {
			return { status: "no-workflow" };
		}
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		const boss = await getBoss();
		const jobId = await boss.send(
			RERUN_QUEUE,
			{
				repoFullName: repo.fullName,
				number: data.number,
				requestedBy: userId ?? "dev",
			},
			{
				singletonKey: `${repo.fullName}#${data.number}`,
				singletonSeconds: RERUN_COOLDOWN_SECONDS,
			},
		);
		if (!jobId) {
			return {
				status: "cooldown",
				retryInSeconds: RERUN_COOLDOWN_SECONDS,
			};
		}
		return { status: "queued" };
	});

export const getActivityFeed = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<ActivityFeedData> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { eventServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const feed = await eventServices.listActivityFeed(getDb().db, {
			repoFullName: repo.fullName,
			limit: 50,
		});
		// Parse at the boundary: a shape mismatch (a drifted normalized event, a
		// mistyped timestamp) fails loudly HERE, never inside a downstream render.
		return activityFeedSchema.parse(feed);
	});
