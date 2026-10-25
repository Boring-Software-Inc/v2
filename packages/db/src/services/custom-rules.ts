import {
	type CustomRuleDefinition,
	customRuleDefinitionSchema,
	customRuleRecordSchema,
	customRuleRef,
	customRuleSentence,
	DEFAULT_RULE_OUTCOME_SETTING,
	parseRuleOutcomeInput,
	RULE_CATALOG,
	type RuleOutcomeSetting,
} from "@tripwire/contracts";
import { storedRuleIssue } from "@tripwire/sdk";
import { generateId } from "@tripwire/utils";
import type { Db } from "../client.ts";
import {
	deleteCustomRule as deleteCustomRuleRow,
	listCustomRules,
	upsertCustomRule,
} from "./repos.ts";

export const CUSTOM_RULE_NAME_MAX = 80;
export const CUSTOM_RULE_DESCRIPTION_MAX = 500;

export interface CustomRuleView {
	id: string;
	ref: string;
	name: string;
	description: string | null;
	enabled: boolean;
	definition: CustomRuleDefinition;
	sentence: string;
	outcome: RuleOutcomeSetting;
}

export type CustomRuleFailure = {
	ok: false;
	reason: "invalid" | "name-taken" | "not-found" | "in-use";
	error: string;
	blockedBy?: { id: string; name: string }[];
};

export type SaveCustomRuleResult =
	| { ok: true; created: boolean; rule: CustomRuleView }
	| CustomRuleFailure;

export type CustomRuleChangeResult =
	| { ok: true; rule: CustomRuleView }
	| CustomRuleFailure;

export type DeleteCustomRuleResult = { ok: true } | CustomRuleFailure;

export function customRuleSlug(name: string): string {
	const base = name
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
		.slice(0, 40)
		.replaceAll(/-+$/g, "");
	return base.length > 0 ? base : "rule";
}

export function newCustomRuleId(name: string): string {
	return `custom-${customRuleSlug(name)}-${generateId().replaceAll("-", "").slice(-6).toLowerCase()}`;
}

function invalid(error: string): CustomRuleFailure {
	return { ok: false, reason: "invalid", error };
}

function notFound(id: string): CustomRuleFailure {
	return {
		ok: false,
		reason: "not-found",
		error: `No custom rule ${id} on this repo.`,
	};
}

export function joinWorkflowNames(names: readonly string[]): string {
	if (names.length <= 1) {
		return names[0] ?? "a workflow";
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function toView(row: {
	id: string;
	name: string;
	description: string | null;
	enabled: boolean;
	definition: unknown;
	outcome?: RuleOutcomeSetting;
}): CustomRuleView | null {
	const parsed = customRuleRecordSchema.safeParse(row);
	if (!parsed.success) {
		return null;
	}
	return {
		id: parsed.data.id,
		ref: customRuleRef(parsed.data.id),
		name: parsed.data.name,
		description: row.description,
		enabled: parsed.data.enabled,
		definition: parsed.data.definition,
		sentence: customRuleSentence(parsed.data.definition),
		outcome: row.outcome ?? DEFAULT_RULE_OUTCOME_SETTING,
	};
}

export async function listCustomRuleViews(
	db: Db,
	repoId: string,
): Promise<CustomRuleView[]> {
	const rows = await listCustomRules(db, repoId);
	return rows.flatMap((row) => {
		const view = toView(row);
		return view ? [view] : [];
	});
}

export function customRuleDefinitionIssue(
	definition: unknown,
):
	| { ok: true; definition: CustomRuleDefinition }
	| { ok: false; error: string } {
	const parsed = customRuleDefinitionSchema.safeParse(definition);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const path = issue?.path.join(".") ?? "";
		const message =
			issue?.message ??
			"This rule is missing a part. Fill in every blank and save again.";
		return { ok: false, error: path ? `${path}: ${message}` : message };
	}
	const issue = storedRuleIssue(parsed.data);
	if (issue !== null) {
		return { ok: false, error: issue };
	}
	return { ok: true, definition: parsed.data };
}

export async function saveCustomRule(
	db: Db,
	input: {
		repoId: string;
		id?: string;
		name: string;
		description?: string | null;
		enabled?: boolean;
		definition: unknown;
		outcome?: { outcome?: string; instruction?: string };
	},
): Promise<SaveCustomRuleResult> {
	const name = input.name.trim();
	if (name.length === 0 || name.length > CUSTOM_RULE_NAME_MAX) {
		return invalid(
			`Give the rule a name of 1 to ${CUSTOM_RULE_NAME_MAX} characters.`,
		);
	}
	const description =
		input.description === undefined || input.description === null
			? input.description
			: input.description.trim() || null;
	if (
		typeof description === "string" &&
		description.length > CUSTOM_RULE_DESCRIPTION_MAX
	) {
		return invalid(
			`Keep the description to ${CUSTOM_RULE_DESCRIPTION_MAX} characters.`,
		);
	}
	const rows = await listCustomRules(db, input.repoId);
	const existing =
		input.id === undefined
			? undefined
			: rows.find((row) => row.id === input.id);
	if (input.id !== undefined && !existing) {
		return notFound(input.id);
	}
	const outcome = input.outcome
		? parseRuleOutcomeInput({
				outcome: input.outcome.outcome ?? existing?.outcome?.outcome,
				instruction:
					input.outcome.instruction ?? existing?.outcome?.instruction,
			})
		: null;
	if (outcome && !outcome.ok) {
		return invalid(outcome.error);
	}
	const checked = customRuleDefinitionIssue(input.definition);
	if (!checked.ok) {
		return invalid(checked.error);
	}
	const lowered = name.toLowerCase();
	const clash =
		rows.some(
			(row) => row.id !== input.id && row.name.trim().toLowerCase() === lowered,
		) || RULE_CATALOG.some((entry) => entry.name.toLowerCase() === lowered);
	if (clash) {
		return {
			ok: false,
			reason: "name-taken",
			error: `A rule named ${name} already exists on this repo. Pick another name.`,
		};
	}
	const taken = new Set(rows.map((row) => row.id));
	let id = existing?.id ?? newCustomRuleId(name);
	while (!existing && taken.has(id)) {
		id = newCustomRuleId(name);
	}
	const record = customRuleRecordSchema.safeParse({
		id,
		name,
		enabled: input.enabled ?? existing?.enabled ?? false,
		definition: checked.definition,
	});
	if (!record.success) {
		return invalid(
			"This rule is missing a part. Fill in every blank and save again.",
		);
	}
	const savedOutcome =
		(outcome?.ok ? outcome.setting : null) ??
		existing?.outcome ??
		DEFAULT_RULE_OUTCOME_SETTING;
	await upsertCustomRule(db, input.repoId, {
		...record.data,
		description,
		outcome: outcome?.ok ? outcome.setting : undefined,
	});
	return {
		ok: true,
		created: !existing,
		rule: {
			id: record.data.id,
			ref: customRuleRef(record.data.id),
			name: record.data.name,
			description:
				description === undefined
					? (existing?.description ?? null)
					: description,
			enabled: record.data.enabled,
			definition: record.data.definition,
			sentence: customRuleSentence(record.data.definition),
			outcome: savedOutcome,
		},
	};
}

export async function setCustomRuleEnabled(
	db: Db,
	input: { repoId: string; id: string; enabled: boolean },
): Promise<CustomRuleChangeResult> {
	const rows = await listCustomRules(db, input.repoId);
	const row = rows.find((entry) => entry.id === input.id);
	const view = row ? toView(row) : null;
	if (!(row && view)) {
		return notFound(input.id);
	}
	await upsertCustomRule(db, input.repoId, {
		id: view.id,
		name: view.name,
		enabled: input.enabled,
		definition: view.definition,
	});
	return { ok: true, rule: { ...view, enabled: input.enabled } };
}

export async function deleteCustomRule(
	db: Db,
	input: { repoId: string; id: string },
): Promise<DeleteCustomRuleResult> {
	const rows = await listCustomRules(db, input.repoId);
	if (!rows.some((row) => row.id === input.id)) {
		return notFound(input.id);
	}
	const result = await deleteCustomRuleRow(db, input.repoId, input.id);
	if (!result.deleted) {
		return {
			ok: false,
			reason: "in-use",
			error: `This rule is used in ${joinWorkflowNames(result.blockedBy.map((workflow) => workflow.name))}. Remove it from those workflows before you delete it.`,
			blockedBy: result.blockedBy,
		};
	}
	return { ok: true };
}
