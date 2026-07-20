import { createServerFn } from "@tanstack/react-start";
import {
	type ActivityFeed,
	type ActivityFeedItem,
	type ActivityGroup,
	type ActivityTimelineEntry,
	activityFeedSchema,
	DEFAULT_WORKFLOW,
	RULE_CATALOG,
	ruleDisplayName,
	ruleIdOf,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { ruleExecutes } from "#/lib/rule-execution";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

// The wire shapes live in @tripwire/contracts (one home, validated). Re-exported
// here under the names the /activity components already use.
export type ActivityRun = import("@tripwire/contracts").ActivityRunSummary;
export type ActivityItem = ActivityTimelineEntry;
export type { ActivityFeedItem, ActivityGroup };
export type ActivityFeedData = ActivityFeed;

export type RerunRequestResult =
	| { status: "queued"; runId: string }
	| { status: "cooldown"; retryInSeconds: number }
	| { status: "no-workflow" }
	| { status: "not-armed" }
	| { status: "no-event" };

export type RerunPreview = {
	/** Display names of rules that will evaluate, in catalog order. */
	ruleNames: string[];
};

/**
 * Names of rules that will evaluate for a re-run, matching deriveDefaultWorkflow
 * + saved-workflow composition. Used by the confirm dialog so the admin sees
 * the set before spending the evaluation.
 */
function executableRuleNames(
	configs: { ruleId: string; enabled: boolean }[],
	enabledWorkflows: {
		nodes: { type: string; ref?: string }[];
	}[],
): string[] {
	const byId = new Map(configs.map((c) => [c.ruleId, c]));
	if (enabledWorkflows.length > 0) {
		const names: string[] = [];
		const seen = new Set<string>();
		for (const wf of enabledWorkflows) {
			for (const node of wf.nodes) {
				if (node.type !== "rule" || !node.ref) {
					continue;
				}
				const id = ruleIdOf(node.ref);
				if (seen.has(id)) {
					continue;
				}
				// Kill-switch: an explicit disabled toggle still skips.
				const row = byId.get(id);
				if (row && !row.enabled) {
					continue;
				}
				seen.add(id);
				names.push(ruleDisplayName(node.ref));
			}
		}
		// Leftover standalone rules (not owned by any workflow) still run.
		for (const entry of RULE_CATALOG) {
			if (seen.has(entry.ruleId)) {
				continue;
			}
			const owned = enabledWorkflows.some((wf) =>
				wf.nodes.some(
					(n) => n.type === "rule" && n.ref && ruleIdOf(n.ref) === entry.ruleId,
				),
			);
			if (owned) {
				continue;
			}
			const row = byId.get(entry.ruleId);
			if (ruleExecutes(`${entry.ruleId}@${entry.version}`, row?.enabled)) {
				names.push(entry.name);
			}
		}
		return names;
	}
	return RULE_CATALOG.filter((entry) =>
		ruleExecutes(
			`${entry.ruleId}@${entry.version}`,
			byId.get(entry.ruleId)?.enabled,
		),
	).map((entry) => entry.name);
}

/**
 * Confirm-dialog copy: which rules will re-evaluate. Caps at 3 named + "and N
 * more" so the line stays scannable.
 */
export function rerunRulesLine(ruleNames: string[]): string {
	if (ruleNames.length === 0) {
		return "no rules will evaluate — enable a rule or workflow first.";
	}
	if (ruleNames.length <= 3) {
		if (ruleNames.length === 1) {
			return `re-runs: ${ruleNames[0]}`;
		}
		if (ruleNames.length === 2) {
			return `re-runs: ${ruleNames[0]} and ${ruleNames[1]}`;
		}
		return `re-runs: ${ruleNames[0]}, ${ruleNames[1]}, and ${ruleNames[2]}`;
	}
	const rest = ruleNames.length - 3;
	return `re-runs: ${ruleNames[0]}, ${ruleNames[1]}, ${ruleNames[2]}, and ${rest} more`;
}

/** Preview the rule set a re-run would evaluate (confirm dialog). */
export const getRerunPreview = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }): Promise<RerunPreview> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const [workflows, configs] = await Promise.all([
			repoServices.listEnabledWorkflows(db, repo.fullName),
			repoServices.listRuleConfigs(db, repo.id),
		]);
		return {
			ruleNames: executableRuleNames(
				configs.map((c) => ({ ruleId: c.ruleId, enabled: c.enabled })),
				workflows,
			),
		};
	});

/**
 * Manual re-run (admin): evaluate the change request again under the CURRENT
 * enabled workflow, as a NEW run, delivered as an amendment. Materializes the
 * run row at enqueue (`queued`) so the activity card moves immediately. The
 * enqueue uses pg-boss singletonKey + singletonSeconds — one re-run per PR per
 * cooldown window; a deduped send returns null and the caller sees the cooldown.
 */
export const rerunChangeRequest = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repo: string; number: number }) => input,
	)
	.handler(async ({ data, context }): Promise<RerunRequestResult> => {
		const org = (context as { org: OrgWithRole }).org;
		const repo = await resolveOrgRepo(org.id, data.repo);
		const {
			repoServices,
			eventServices,
			runServices,
			staffServices,
			RERUN_QUEUE,
			getRerunCooldownSeconds,
		} = await import("@tripwire/db");
		const { getDb, getBoss } = await import("#/lib/server/db");
		const { db, pool } = getDb();
		if (!repo.armed) {
			return { status: "not-armed" };
		}
		const [workflows, configs] = await Promise.all([
			repoServices.listEnabledWorkflows(db, repo.fullName),
			repoServices.listRuleConfigs(db, repo.id),
		]);
		const names = executableRuleNames(
			configs.map((c) => ({ ruleId: c.ruleId, enabled: c.enabled })),
			workflows,
		);
		if (names.length === 0) {
			return { status: "no-workflow" };
		}
		const eventRow = await eventServices.getLatestChangeRequestEvent(
			db,
			repo.fullName,
			data.number,
		);
		if (!eventRow) {
			return { status: "no-event" };
		}
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		const requestedBy = userId ?? "dev";
		// Duration is env-global; exemption is a staff flag per account.
		const cooldownSeconds = getRerunCooldownSeconds();
		const cooldownExempt =
			userId != null
				? await staffServices.isRerunCooldownExempt(db, userId)
				: false;

		// Materialize the run NOW so the activity card shows evaluating
		// immediately. Provisional snapshot is overwritten when the worker
		// finalizes under the real derived definition.
		const headSha =
			eventRow.normalized &&
			typeof eventRow.normalized === "object" &&
			"changeRequest" in eventRow.normalized &&
			eventRow.normalized.changeRequest &&
			typeof eventRow.normalized.changeRequest === "object" &&
			"headSha" in eventRow.normalized.changeRequest
				? String(
						(eventRow.normalized.changeRequest as { headSha: string }).headSha,
					)
				: null;
		const runId = await runServices.createRun(db, {
			eventId: eventRow.id,
			repoFullName: repo.fullName,
			subjectNumber: data.number,
			headSha,
			snapshot: [DEFAULT_WORKFLOW],
			status: "queued",
			verdict: null,
			triggeredBy: requestedBy,
		});

		const boss = await getBoss();
		const jobId = await boss.send(
			RERUN_QUEUE,
			{
				repoFullName: repo.fullName,
				number: data.number,
				requestedBy,
				runId,
			},
			cooldownExempt || cooldownSeconds === 0
				? // No singleton: rapid re-runs allowed (staff-flagged or env=0).
					{}
				: {
						singletonKey: `${repo.fullName}#${data.number}`,
						singletonSeconds: cooldownSeconds,
					},
		);
		if (!jobId) {
			// Cooldown hit after we materialized — mark failed so the card is not
			// stuck forever-queued, and report the cooldown.
			await runServices.failRun(db, runId);
			return {
				status: "cooldown",
				retryInSeconds: cooldownSeconds,
			};
		}
		// Fan-out so the live activity feed resolves the queued run without a
		// full refetch (same NOTIFY channel the worker uses on completion).
		await pool.query("SELECT pg_notify('runs', $1)", [eventRow.id]);
		return { status: "queued", runId };
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
