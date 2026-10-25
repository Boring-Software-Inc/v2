import {
	DEFAULT_RULE_OUTCOME_SETTING,
	type ExceptionDraftRule,
	exceptionDraft,
	type JsonValue,
	RULE_CATALOG,
	ruleExceptionGates,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { workflowDefinitions } from "../schema/repos.ts";
import { listCustomRules, listRuleConfigs } from "./repos.ts";
import { workflowOwnsOutcome } from "./rules.ts";
import { createWorkflow } from "./workflows.ts";

export type ExceptionDraftResult =
	| { ok: true; workflowId: string; created: boolean }
	| { ok: false; error: string };

async function draftRule(
	db: Db,
	repoId: string,
	ruleId: string,
): Promise<{ name: string; rule: ExceptionDraftRule } | null> {
	if (ruleId.startsWith("custom-")) {
		const row = (await listCustomRules(db, repoId)).find(
			(entry) => entry.id === ruleId,
		);
		return row
			? {
					name: row.name,
					rule: {
						ref: `${row.id}@1`,
						config: {},
						outcome: row.outcome ?? DEFAULT_RULE_OUTCOME_SETTING,
					},
				}
			: null;
	}
	const entry = RULE_CATALOG.find((candidate) => candidate.ruleId === ruleId);
	if (!entry) {
		return null;
	}
	const stored = (await listRuleConfigs(db, repoId)).find(
		(row) => row.ruleId === ruleId,
	);
	const config =
		stored && entry.configSchema.safeParse(stored.config).success
			? (stored.config as JsonValue)
			: (entry.defaultConfig as JsonValue);
	return {
		name: entry.name,
		rule: {
			ref: `${entry.ruleId}@${entry.version}`,
			config,
			outcome: stored?.outcome ?? DEFAULT_RULE_OUTCOME_SETTING,
		},
	};
}

async function openDraft(
	db: Db,
	repoId: string,
	ruleId: string,
): Promise<string | null> {
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.repoId, repoId),
				eq(workflowDefinitions.enabled, false),
			),
		)
		.orderBy(workflowDefinitions.createdAt);
	const match = rows.find((row) => {
		const parsed = workflowDefinitionSchema.safeParse(row.definition);
		return parsed.success && ruleExceptionGates(parsed.data, ruleId).length > 0;
	});
	return match?.id ?? null;
}

export async function openRuleExceptionDraft(
	db: Db,
	input: { repoId: string; ruleId: string },
): Promise<ExceptionDraftResult> {
	const found = await draftRule(db, input.repoId, input.ruleId);
	if (!found) {
		return {
			ok: false,
			error: `No rule ${input.ruleId} on this repo. Reload the page and try again.`,
		};
	}
	const owned = await workflowOwnsOutcome(db, input.repoId, input.ruleId);
	if (owned) {
		return { ok: false, error: owned };
	}
	const existing = await openDraft(db, input.repoId, input.ruleId);
	if (existing) {
		return { ok: true, workflowId: existing, created: false };
	}
	const workflow = await createWorkflow(db, {
		repoId: input.repoId,
		name: found.name,
		definition: exceptionDraft({
			id: generateId(),
			name: found.name,
			rule: found.rule,
		}),
	});
	return { ok: true, workflowId: workflow.id, created: true };
}
