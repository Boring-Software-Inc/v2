import { createServerFn } from "@tanstack/react-start";
import {
	type CustomRuleDefinition,
	type CustomRuleRecord,
	customRuleDefinitionSchema,
	customRuleRecordSchema,
	customRuleSentence,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { storedRuleIssue } from "@tripwire/sdk";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

/**
 * Custom-rule CRUD. The stored definition is the serialized SDK shape;
 * writes validate twice: the contracts schema (shape, safe verbs) and the
 * sdk's storedRuleIssue (signal exists, verb fits the signal's type, window
 * within history). The evaluator re-checks everything at run time.
 */

export interface CustomRuleView {
	id: string;
	name: string;
	enabled: boolean;
	definition: CustomRuleDefinition;
	sentence: string;
}

function slugify(name: string): string {
	const base = name
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
		.slice(0, 40);
	return base.length > 0 ? base : "rule";
}

export const listCustomRuleViews = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<CustomRuleView[]> => {
		await requireOrgRepoById(
			(context as { org: OrgWithRole }).org.id,
			data.repoId,
		);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const rows = await repoServices.listCustomRules(getDb().db, data.repoId);
		const views: CustomRuleView[] = [];
		for (const row of rows) {
			const parsed = customRuleRecordSchema.safeParse(row);
			if (parsed.success) {
				views.push({
					...parsed.data,
					sentence: customRuleSentence(parsed.data.definition),
				});
			}
		}
		return views;
	});

export const saveCustomRule = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: {
			org: string;
			repoId: string;
			/** Absent on create; present on edit. */
			id?: string;
			name: string;
			enabled: boolean;
			definition: unknown;
		}) => input,
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ ok: true; id: string } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const name = data.name.trim();
			if (name.length === 0 || name.length > 80) {
				return { error: "the rule needs a name under 80 characters" };
			}
			const parsed = customRuleDefinitionSchema.safeParse(data.definition);
			if (!parsed.success) {
				return {
					error: parsed.error.issues[0]?.message ?? "invalid rule definition",
				};
			}
			const issue = storedRuleIssue(parsed.data);
			if (issue !== null) {
				return { error: issue };
			}
			const { repoServices } = await import("@tripwire/db");
			const { generateId } = await import("@tripwire/utils");
			const { getDb } = await import("#/lib/server/db");
			const db = getDb().db;
			if (data.id !== undefined) {
				// Edits keep the id: refs in saved workflows stay valid.
				const existing = await repoServices.listCustomRules(db, data.repoId);
				if (!existing.some((row) => row.id === data.id)) {
					return { error: "rule not found" };
				}
			}
			const id =
				data.id ?? `custom-${slugify(name)}-${generateId().slice(0, 6)}`;
			const record: CustomRuleRecord = {
				id,
				name,
				enabled: data.enabled,
				definition: parsed.data,
			};
			const recordCheck = customRuleRecordSchema.safeParse(record);
			if (!recordCheck.success) {
				return { error: "invalid rule" };
			}
			await repoServices.upsertCustomRule(db, data.repoId, record);
			return { ok: true, id };
		},
	);

export const setCustomRuleEnabled = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; repoId: string; id: string; enabled: boolean }) =>
			input,
	)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { repoServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const db = getDb().db;
			const rows = await repoServices.listCustomRules(db, data.repoId);
			const row = rows.find((entry) => entry.id === data.id);
			if (!row) {
				return { error: "rule not found" };
			}
			await repoServices.upsertCustomRule(db, data.repoId, {
				id: row.id,
				name: row.name,
				enabled: data.enabled,
				definition: row.definition,
			});
			return { ok: true };
		},
	);

export const deleteCustomRule = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string; repoId: string; id: string }) => input)
	.handler(
		async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
			await requireOrgRepoById(
				(context as { org: OrgWithRole }).org.id,
				data.repoId,
			);
			const { repoServices } = await import("@tripwire/db");
			const { getDb } = await import("#/lib/server/db");
			const result = await repoServices.deleteCustomRule(
				getDb().db,
				data.repoId,
				data.id,
			);
			if (!result.deleted) {
				const names = joinRuleWorkflowNames(
					result.blockedBy.map((w) => w.name),
				);
				return {
					error: `this rule is active inside ${names}. remove it from those workflows before deleting.`,
				};
			}
			return { ok: true };
		},
	);

/** Names the blocking workflows plainly: "a", "a and b", "a, b, and c". */
function joinRuleWorkflowNames(names: string[]): string {
	if (names.length <= 1) {
		return names[0] ?? "a workflow";
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
