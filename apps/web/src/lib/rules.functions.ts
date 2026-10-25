import { createServerFn } from "@tanstack/react-start";
import { RULE_CATALOG } from "@tripwire/contracts";
import type {
	OrgWithRole,
	RuleConfigView,
	RulesHeaderStats,
} from "@tripwire/db";
import { resolveRuleUpgrade } from "#/lib/rule-upgrade";
import type { JsonValue } from "#/lib/runs.functions";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export type { RuleConfigView, RulesHeaderStats };

async function queueBranchSync(repoId: string): Promise<void> {
	const { getBoss, isDemoMode } = await import("#/lib/server/db");
	if (isDemoMode()) {
		return;
	}
	const { SYNC_REPO_BRANCHES_QUEUE, syncRepoBranchesOptions } = await import(
		"@tripwire/db"
	);
	const boss = await getBoss();
	await boss.send(
		SYNC_REPO_BRANCHES_QUEUE,
		{ repoId },
		syncRepoBranchesOptions(repoId),
	);
}

export const listRuleConfigViews = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:read")])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RuleConfigView[]> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { ruleServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await ruleServices.listRuleViews(getDb().db, data.repoId);
	});

export const getRulesHeaderStats = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:read")])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<RulesHeaderStats> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { ruleServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return await ruleServices.getRulesHeaderStats(getDb().db, data.repoId);
	});

export const saveRuleConfig = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
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
			const { ruleServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			return await ruleServices.saveRuleConfig(getDb().db, {
				repoId: data.repoId,
				ruleId: data.ruleId,
				enabled: data.enabled,
				config: data.config,
			});
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
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
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
				return {
					error: `Tripwire does not know the rule ${data.ruleId}. Reload the page and try again.`,
				};
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

/**
 * Cached builder suggestions for a repo and kind (branch names, etc.). Read
 * only: the worker populates the cache with the installation token, so the web
 * never calls the forge. Empty until the worker has refreshed, and the builder
 * falls back to free text.
 */
export const getRepoSuggestions = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:read")])
	.inputValidator(
		(input: { org: string; repoId: string; kind: string }) => input,
	)
	.handler(async ({ data, context }): Promise<string[]> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const list = await repoServices.getRepoSuggestionList(
			getDb().db,
			data.repoId,
			data.kind,
		);
		if (
			data.kind === "branches" &&
			repoServices.suggestionsNeedSync(list.updatedAt, new Date())
		) {
			await queueBranchSync(data.repoId);
		}
		return list.values;
	});
