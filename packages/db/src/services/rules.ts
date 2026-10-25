import {
	AI_CREDITS_COPY,
	AI_REVIEW_RULE_ID,
	customRuleRecordSchema,
	customRuleSentence,
	DEFAULT_RULE_OUTCOME_SETTING,
	type JsonValue,
	type ModStat,
	parseRuleOutcomeInput,
	RULE_CATALOG,
	type RuleManagement,
	type RuleOutcomeSetting,
	resolveEffectiveRuleConfig,
	resolveRuleManagement,
	ruleChangeNote,
	ruleExecutes,
	ruleForgeBlockReason,
	ruleIdOf,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import type { Db } from "../client.ts";
import { getAiCredits } from "./ai-provider.ts";
import { getRulesStats } from "./insights.ts";
import {
	getRepoById,
	listCustomRules,
	listEnabledWorkflowRows,
	listEnabledWorkflows,
	listRuleConfigs,
	setRuleOutcome as setRuleOutcomeRow,
	upsertRuleConfig,
	workflowsReferencingRule,
} from "./repos.ts";

export interface RuleConfigView {
	ruleId: string;
	/**
	 * Plain-language reason this rule cannot run on THIS repo's forge, or null
	 * when it can. Set ⇒ the card is inert: the forge does not expose what the
	 * rule needs, so toggling it on would arm something that never fires.
	 */
	forgeBlockReason: string | null;
	unavailableReason: string | null;
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
	/** Which registration path defined the rule. Presentation and lifecycle
	 * only (the custom tag, edit-in-builder, delete); never behavior. */
	source: "built-in" | "custom";
	/** The read-state sentence for a custom rule; null for built-ins. */
	sentence: string | null;
	/** Workflows (enabled OR disabled) that reference a custom rule — deletion is
	 * refused while non-empty, and the card names them. Empty for built-ins. */
	blockingWorkflows: { id: string; name: string }[];
	outcome: RuleOutcomeSetting;
	owners: { id: string; name: string }[];
}

export function ruleOwners(
	ruleId: string,
	enabledRows: readonly { id: string; definition: WorkflowDefinition }[],
): { id: string; name: string }[] {
	return enabledRows
		.filter((row) =>
			row.definition.nodes.some(
				(node) => node.type === "rule" && ruleIdOf(node.ref) === ruleId,
			),
		)
		.map((row) => ({ id: row.id, name: row.definition.name }));
}

export interface RulesHeaderStats {
	activeRules: number;
	matches24h: ModStat;
	actioned24h: ModStat;
	/** null until reversals are tracked — render "not enough data" (§6 loop). */
	falsePositiveRate: null;
}

export async function listRuleViews(
	db: Db,
	repoId: string,
): Promise<RuleConfigView[]> {
	const repo = await getRepoById(db, repoId);
	const stored = await listRuleConfigs(db, repoId);
	// Per-rule management derives from ENABLED workflow node refs (§6,
	// workflow-only), not a repo-level boolean — that was the all-locked bug.
	// Rows carry the CRUD row id AND the definition (whose wire `id` differs);
	// resolveRuleManagement returns the wire id, so we map wire→row for the
	// "edit in workflow" link — it targets the editor route, keyed by row id.
	const enabledRows = repo
		? await listEnabledWorkflowRows(db, repo.fullName, repo.forge)
		: [];
	const enabledWorkflows = enabledRows.map((row) => row.definition);
	const workflowRowIdByWireId = new Map(
		enabledRows.map((row) => [row.definition.id, row.id]),
	);
	const linkWorkflowId = (wireId: string | null): string | null =>
		wireId ? (workflowRowIdByWireId.get(wireId) ?? null) : null;
	const stats = repo ? await getRulesStats(db, repo.fullName) : { perRule: [] };
	const byRef = new Map(stats.perRule.map((s) => [s.ref, s]));
	const customRows = await listCustomRules(db, repoId);
	// Which workflows (enabled OR disabled) reference each custom rule — the
	// card disables delete and names them, mirroring the server guard.
	const blockingByRuleId = new Map<string, { id: string; name: string }[]>();
	await Promise.all(
		customRows.map(async (row) => {
			blockingByRuleId.set(
				row.id,
				await workflowsReferencingRule(db, repoId, row.id),
			);
		}),
	);
	const customViews: RuleConfigView[] = [];
	for (const rowRaw of customRows) {
		const parsedRow = customRuleRecordSchema.safeParse(rowRaw);
		if (!parsedRow.success) {
			continue;
		}
		const record = parsedRow.data;
		const ref = `${record.id}@1`;
		const perRule = byRef.get(ref);
		const mgmt = resolveRuleManagement(record.id, enabledWorkflows);
		const sentence = customRuleSentence(record.definition);
		customViews.push({
			ruleId: record.id,
			// Not blocked at the CARD level: a custom rule picks its own signals,
			// so support is per-signal, not per-rule. 24 of the 52 custom signals
			// are contributor/repoRelation reads, which a forge can absolutely
			// starve — those skip honestly at evaluation with the signal's own
			// unavailable reason. Pre-disabling the whole card would be wrong,
			// since most custom rules use pr.* signals that always resolve.
			// TODO(per-signal-support): surface unusable signals in the builder.
			forgeBlockReason: null,
			unavailableReason: null,
			version: 1,
			held: false,
			changeNote: null,
			name: record.name,
			blurb: sentence,
			enabled: mgmt.state === "managed" ? true : record.enabled,
			config: {},
			defaultConfig: {},
			management: mgmt.state,
			workflowId: linkWorkflowId(mgmt.workflowId),
			optIn: false,
			matches24h: perRule?.matches24h ?? 0,
			trend: perRule?.series ?? Array(24).fill(0),
			source: "custom",
			sentence,
			blockingWorkflows: blockingByRuleId.get(record.id) ?? [],
			outcome: rowRaw.outcome ?? DEFAULT_RULE_OUTCOME_SETTING,
			owners: ruleOwners(record.id, enabledRows),
		});
	}
	const aiCredits = await getAiCredits(db);
	const builtIns = RULE_CATALOG.map((entry): RuleConfigView => {
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
			forgeBlockReason: repo
				? ruleForgeBlockReason(entry.ruleId, repo.forge)
				: null,
			unavailableReason:
				entry.ruleId === AI_REVIEW_RULE_ID && aiCredits === "out"
					? AI_CREDITS_COPY.reason
					: null,
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
			workflowId: linkWorkflowId(mgmt.workflowId),
			optIn: entry.optIn,
			matches24h: perRule?.matches24h ?? 0,
			trend: perRule?.series ?? Array(24).fill(0),
			source: "built-in",
			sentence: null,
			blockingWorkflows: [],
			outcome: row?.outcome ?? DEFAULT_RULE_OUTCOME_SETTING,
			owners: ruleOwners(entry.ruleId, enabledRows),
		};
	});
	return [...builtIns, ...customViews];
}

export async function getRulesHeaderStats(
	db: Db,
	repoId: string,
): Promise<RulesHeaderStats> {
	const repo = await getRepoById(db, repoId);
	const stored = await listRuleConfigs(db, repoId);
	// A rule counts as active if a workflow owns it (§6) OR its standalone
	// toggle runs it. Managed rules are active regardless of the toggle.
	const enabledWorkflows = repo
		? await listEnabledWorkflows(db, repo.fullName, repo.forge)
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
	const stats = await getRulesStats(db, repo.fullName);
	return {
		activeRules,
		matches24h: stats.matches24h,
		actioned24h: stats.actioned24h,
		falsePositiveRate: null,
	};
}

export type SaveRuleResult = { ok: true } | { error: string };

export async function saveRuleConfig(
	db: Db,
	input: {
		repoId: string;
		ruleId: string;
		enabled: boolean;
		config: unknown;
	},
): Promise<SaveRuleResult> {
	const entry = RULE_CATALOG.find((r) => r.ruleId === input.ruleId);
	if (!entry) {
		return {
			error: `Tripwire does not know the rule ${input.ruleId}. Reload the page and try again.`,
		};
	}
	const parsed = entry.configSchema.safeParse(input.config);
	if (!parsed.success) {
		return {
			error:
				parsed.error.issues[0]?.message ??
				"These settings are not valid. Check the values and save again.",
		};
	}
	if (
		input.enabled &&
		entry.ruleId === AI_REVIEW_RULE_ID &&
		(await getAiCredits(db)) === "out"
	) {
		const current = (await listRuleConfigs(db, input.repoId)).find(
			(row) => row.ruleId === entry.ruleId,
		);
		if (!ruleExecutes(`${entry.ruleId}@${entry.version}`, current?.enabled)) {
			return { error: AI_CREDITS_COPY.cantRun };
		}
	}
	await upsertRuleConfig(db, input.repoId, {
		ruleId: entry.ruleId,
		version: entry.version,
		enabled: input.enabled,
		config: parsed.data,
	});
	return { ok: true };
}

export async function setRulesEnabled(
	db: Db,
	input: { repoId: string; ruleIds: readonly string[]; enabled: boolean },
): Promise<SaveRuleResult> {
	const stored = await listRuleConfigs(db, input.repoId);
	for (const ruleId of input.ruleIds) {
		const entry = RULE_CATALOG.find((r) => r.ruleId === ruleId);
		if (!entry) {
			return {
				error: `Tripwire does not know the rule ${ruleId}. Reload the page and try again.`,
			};
		}
		const row = stored.find((c) => c.ruleId === ruleId);
		const config =
			row && entry.configSchema.safeParse(row.config).success
				? row.config
				: entry.defaultConfig;
		const result = await saveRuleConfig(db, {
			repoId: input.repoId,
			ruleId,
			enabled: input.enabled,
			config,
		});
		if ("error" in result) {
			return result;
		}
	}
	return { ok: true };
}

export async function setRuleOutcome(
	db: Db,
	input: {
		repoId: string;
		ruleId: string;
		outcome: string;
		instruction?: string;
	},
): Promise<SaveRuleResult> {
	const parsed = parseRuleOutcomeInput({
		outcome: input.outcome,
		instruction: input.instruction ?? "",
	});
	if (!parsed.ok) {
		return { error: parsed.error };
	}
	const repo = await getRepoById(db, input.repoId);
	const enabledRows = repo
		? await listEnabledWorkflowRows(db, repo.fullName, repo.forge)
		: [];
	const owners = ruleOwners(input.ruleId, enabledRows);
	if (owners.length > 0) {
		return {
			error: `Set in ${owners.map((owner) => owner.name).join(", ")}. Change the outcome in the workflow.`,
		};
	}
	const custom = input.ruleId.startsWith("custom-");
	if (custom) {
		const exists = (await listCustomRules(db, input.repoId)).some(
			(row) => row.id === input.ruleId,
		);
		if (!exists) {
			return { error: `No custom rule ${input.ruleId} on this repo.` };
		}
	} else {
		const entry = RULE_CATALOG.find((r) => r.ruleId === input.ruleId);
		if (!entry) {
			return {
				error: `Tripwire does not know the rule ${input.ruleId}. Reload the page and try again.`,
			};
		}
		const stored = (await listRuleConfigs(db, input.repoId)).some(
			(row) => row.ruleId === entry.ruleId,
		);
		if (!stored) {
			await upsertRuleConfig(db, input.repoId, {
				ruleId: entry.ruleId,
				version: entry.version,
				enabled: false,
				config: entry.defaultConfig,
			});
		}
	}
	await setRuleOutcomeRow(db, input.repoId, input.ruleId, parsed.setting);
	return { ok: true };
}
