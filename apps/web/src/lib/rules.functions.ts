import { createServerFn } from "@tanstack/react-start";
import type { ModStat, RuleManagement } from "@tripwire/contracts";
import {
	RULE_CATALOG,
	resolveEffectiveRuleConfig,
	resolveRuleManagement,
	ruleChangeNote,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { ruleExecutes } from "#/lib/rule-execution";
import { resolveRuleUpgrade } from "#/lib/rule-upgrade";
import type { JsonValue } from "#/lib/runs.functions";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export interface RuleConfigView {
	ruleId: string;
	/** The catalog's CURRENT version — what a repo runs once advanced. */
	version: number;
	/**
	 * True ONLY when the repo is HELD on an older version: its saved config can't
	 * carry forward under the new schema (§6 b). Lossless upgrades auto-advance
	 * silently and never set this — it's the sole state the Rules page surfaces.
	 */
	held: boolean;
	/** What the current version changed — shown with the held re-confirm prompt. */
	changeNote: string | null;
	name: string;
	blurb: string;
	/** ACTUAL execution state (derive.ts): baseline rules run unless disabled. */
	enabled: boolean;
	/** For a MANAGED rule this is the workflow NODE's config (what runs); for
	 * standalone it's the rule's own config. Never a config that isn't what the
	 * executor walks. */
	config: JsonValue;
	defaultConfig: JsonValue;
	/**
	 * Per-rule management (§6 — workflows compose, they don't disable): `managed`
	 * (a node in an enabled workflow; edit it there) or `standalone` (not owned
	 * by any workflow; its own toggle + config run, edit it here).
	 */
	management: RuleManagement;
	/** Deep-link target for edit-in-workflow; null when standalone. */
	workflowId: string | null;
	/** Opt-in rule (§8): off until enabled, rendered as an offer not a toggle. */
	optIn: boolean;
	/** Rule-node fails for this rule over the last 24h, this repo. */
	matches24h: number;
	/** Hourly fail counts over the last 24h — the card sparkline. */
	trend: number[];
}

export interface RulesHeaderStats {
	activeRules: number;
	matches24h: ModStat;
	actioned24h: ModStat;
	/** null until reversals are tracked — render "not enough data" (§6 loop). */
	falsePositiveRate: null;
}

export const listRuleConfigViews = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RuleConfigView[]> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { repoServices, insightServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const repo = await repoServices.getRepoById(db, data.repoId);
		const stored = await repoServices.listRuleConfigs(db, data.repoId);
		// Per-rule management derives from ENABLED workflow node refs (§6,
		// workflow-only), not a repo-level boolean — that was the all-locked bug.
		const enabledWorkflows = repo
			? await repoServices.listEnabledWorkflows(db, repo.fullName)
			: [];
		const stats = repo
			? await insightServices.getRulesStats(db, repo.fullName)
			: { perRule: [] };
		const byRef = new Map(stats.perRule.map((s) => [s.ref, s]));
		return RULE_CATALOG.map((entry) => {
			const row = stored.find((c) => c.ruleId === entry.ruleId);
			const ref = `${entry.ruleId}@${entry.version}`;
			const perRule = byRef.get(ref);
			const held = row
				? resolveEffectiveRuleConfig({
						ruleId: row.ruleId,
						version: row.version,
						enabled: row.enabled,
						config: row.config as JsonValue,
					}).held
				: false;
			const mgmt = resolveRuleManagement(entry.ruleId, enabledWorkflows);
			// Managed ⇒ show the node's config (what runs); else the rule's own.
			const config = (
				mgmt.state === "managed"
					? mgmt.managedConfig
					: (row?.config ?? entry.defaultConfig)
			) as JsonValue;
			return {
				ruleId: entry.ruleId,
				version: entry.version,
				held,
				changeNote: held ? ruleChangeNote(ref) : null,
				name: entry.name,
				blurb: entry.blurb,
				// A managed rule is active because its workflow owns it (§6) — the
				// standalone toggle does not gate it. Standalone rules read the
				// toggle (baseline-aware).
				enabled:
					mgmt.state === "managed" ? true : ruleExecutes(ref, row?.enabled),
				config,
				defaultConfig: entry.defaultConfig as JsonValue,
				management: mgmt.state,
				workflowId: mgmt.workflowId,
				optIn: entry.optIn,
				matches24h: perRule?.matches24h ?? 0,
				trend: perRule?.series ?? Array(24).fill(0),
			};
		});
	});

export const getRulesHeaderStats = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RulesHeaderStats> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { repoServices, insightServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const repo = await repoServices.getRepoById(db, data.repoId);
		const stored = await repoServices.listRuleConfigs(db, data.repoId);
		// A rule counts as active if a workflow owns it (§6) OR its standalone
		// toggle runs it. Managed rules are active regardless of the toggle.
		const enabledWorkflows = repo
			? await repoServices.listEnabledWorkflows(db, repo.fullName)
			: [];
		const activeRules = RULE_CATALOG.filter(
			(entry) =>
				resolveRuleManagement(entry.ruleId, enabledWorkflows).state ===
					"managed" ||
				ruleExecutes(
					`${entry.ruleId}@${entry.version}`,
					stored.find((c) => c.ruleId === entry.ruleId)?.enabled,
				),
		).length;
		const emptyStat: ModStat = { value: 0, delta: 0, series: [] };
		if (!repo) {
			return {
				activeRules,
				matches24h: emptyStat,
				actioned24h: emptyStat,
				falsePositiveRate: null,
			};
		}
		const stats = await insightServices.getRulesStats(db, repo.fullName);
		return {
			activeRules,
			matches24h: stats.matches24h,
			actioned24h: stats.actioned24h,
			falsePositiveRate: null,
		};
	});

export const saveRuleConfig = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			ruleId: string;
			enabled: boolean;
			config: JsonValue;
		}) => input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const entry = RULE_CATALOG.find((r) => r.ruleId === data.ruleId);
			if (!entry) {
				return { error: `unknown rule ${data.ruleId}` };
			}
			const parsed = entry.configSchema.safeParse(data.config);
			if (!parsed.success) {
				return { error: parsed.error.issues[0]?.message ?? "invalid config" };
			}
			const { repoServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			await repoServices.upsertRuleConfig(getDb().db, data.repoId, {
				ruleId: entry.ruleId,
				version: entry.version,
				enabled: data.enabled,
				config: parsed.data,
			});
			return { ok: true };
		},
	);

/**
 * §6 (b) — resolve a HELD rule: re-pin it to the catalog's CURRENT version.
 * Lossless upgrades auto-advance at evaluation time (no action needed); this is
 * the admin-only escape hatch for the held case, where the saved config can't
 * carry forward, so `resolveRuleUpgrade` resets it to the new default (the
 * maintainer then re-tunes). No-ops when unconfigured or already current.
 */
export const upgradeRuleConfig = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; ruleId: string }) => input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const entry = RULE_CATALOG.find((r) => r.ruleId === data.ruleId);
			if (!entry) {
				return { error: `unknown rule ${data.ruleId}` };
			}
			const { repoServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const db = getDb().db;
			const existing = (
				await repoServices.listRuleConfigs(db, data.repoId)
			).find((c) => c.ruleId === data.ruleId);
			const next = resolveRuleUpgrade(existing, entry);
			if (!next) {
				return { ok: true }; // already current, or nothing pinned to upgrade
			}
			await repoServices.upsertRuleConfig(db, data.repoId, {
				ruleId: entry.ruleId,
				version: next.version,
				enabled: next.enabled,
				config: next.config,
			});
			return { ok: true };
		},
	);
