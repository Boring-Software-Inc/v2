import { createServerFn } from "@tanstack/react-start";
import { RULE_CATALOG } from "@tripwire/contracts";
import type { JsonValue } from "#/lib/runs.functions";

export interface RepoOption {
	id: string;
	fullName: string;
}

export interface RuleConfigView {
	ruleId: string;
	version: number;
	name: string;
	blurb: string;
	enabled: boolean;
	config: JsonValue;
	defaultConfig: JsonValue;
	/** Repo has a saved workflow — the toggle is a kill switch over it (§6). */
	managedByWorkflow: boolean;
}

export const listRepoOptions = createServerFn({ method: "GET" }).handler(
	async (): Promise<RepoOption[]> => {
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const rows = await repoServices.listActiveRepos(getDb().db);
		return rows.map((row) => ({ id: row.id, fullName: row.fullName }));
	},
);

export const listRuleConfigViews = createServerFn({ method: "GET" })
	.inputValidator((input: { repoId: string }) => input)
	.handler(async ({ data }): Promise<RuleConfigView[]> => {
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const stored = await repoServices.listRuleConfigs(db, data.repoId);
		const managedByWorkflow = await repoServices.hasEnabledWorkflow(
			db,
			data.repoId,
		);
		return RULE_CATALOG.map((entry) => {
			const row = stored.find((c) => c.ruleId === entry.ruleId);
			return {
				ruleId: entry.ruleId,
				version: entry.version,
				name: entry.name,
				blurb: entry.blurb,
				enabled: row?.enabled ?? false,
				config: (row?.config ?? entry.defaultConfig) as JsonValue,
				defaultConfig: entry.defaultConfig as JsonValue,
				managedByWorkflow,
			};
		});
	});

export const saveRuleConfig = createServerFn({ method: "POST" })
	.inputValidator(
		(input: {
			repoId: string;
			ruleId: string;
			enabled: boolean;
			config: JsonValue;
		}) => input,
	)
	.handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
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
	});
