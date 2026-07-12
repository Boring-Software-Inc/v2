import { createServerFn } from "@tanstack/react-start";
import type { ModStat } from "@tripwire/contracts";
import { RULE_CATALOG } from "@tripwire/contracts";
import { ruleExecutes } from "#/lib/rule-execution";
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
	/** ACTUAL execution state (derive.ts): baseline rules run unless disabled. */
	enabled: boolean;
	config: JsonValue;
	defaultConfig: JsonValue;
	/** Repo has a saved workflow — the toggle is a kill switch over it (§6). */
	managedByWorkflow: boolean;
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

export const listRepoOptions = createServerFn({ method: "GET" }).handler(
	async (): Promise<RepoOption[]> => {
		const { requireSession } = await import("#/lib/server/session");
		await requireSession();
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const rows = await repoServices.listActiveRepos(getDb().db);
		return rows.map((row) => ({ id: row.id, fullName: row.fullName }));
	},
);

export const listRuleConfigViews = createServerFn({ method: "GET" })
	.inputValidator((input: { repoId: string }) => input)
	.handler(async ({ data }): Promise<RuleConfigView[]> => {
		const { requireSession } = await import("#/lib/server/session");
		await requireSession();
		const { repoServices, insightServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const repo = await repoServices.getRepoById(db, data.repoId);
		const stored = await repoServices.listRuleConfigs(db, data.repoId);
		const managedByWorkflow = await repoServices.hasEnabledWorkflow(
			db,
			data.repoId,
		);
		const stats = repo
			? await insightServices.getRulesStats(db, repo.fullName)
			: { perRule: [] };
		const byRef = new Map(stats.perRule.map((s) => [s.ref, s]));
		return RULE_CATALOG.map((entry) => {
			const row = stored.find((c) => c.ruleId === entry.ruleId);
			const ref = `${entry.ruleId}@${entry.version}`;
			const perRule = byRef.get(ref);
			return {
				ruleId: entry.ruleId,
				version: entry.version,
				name: entry.name,
				blurb: entry.blurb,
				enabled: ruleExecutes(ref, row?.enabled),
				config: (row?.config ?? entry.defaultConfig) as JsonValue,
				defaultConfig: entry.defaultConfig as JsonValue,
				managedByWorkflow,
				matches24h: perRule?.matches24h ?? 0,
				trend: perRule?.series ?? Array(24).fill(0),
			};
		});
	});

export const getRulesHeaderStats = createServerFn({ method: "GET" })
	.inputValidator((input: { repoId: string }) => input)
	.handler(async ({ data }): Promise<RulesHeaderStats> => {
		const { requireSession } = await import("#/lib/server/session");
		await requireSession();
		const { repoServices, insightServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const repo = await repoServices.getRepoById(db, data.repoId);
		const stored = await repoServices.listRuleConfigs(db, data.repoId);
		const activeRules = RULE_CATALOG.filter((entry) =>
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
	.inputValidator(
		(input: {
			repoId: string;
			ruleId: string;
			enabled: boolean;
			config: JsonValue;
		}) => input,
	)
	.handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
		const { requireSession } = await import("#/lib/server/session");
		await requireSession();
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
