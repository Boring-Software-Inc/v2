import {
	customRuleRecordSchema,
	diffWorkflow,
	lintWorkflow,
	mergeForPush,
	resolveCatalog,
	stripWorkflowSecrets,
	unrunnableIssues,
	type ValidationCatalogEntry,
	type ValidationIssue,
	validateWorkflowForEnable,
	type WorkflowChange,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId, pickWorkflowName } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { customRules, repos, workflowDefinitions } from "../schema/repos.ts";
import { listRepoReviewers } from "./reviewers.ts";

/**
 * Workflow CRUD (§workflows grid). The grid keys everything by the ROW id
 * (workflow_definitions.id) — `definition.id` is wire identity inside runs
 * and snapshots, not the CRUD handle. Invariants owned here:
 *   - new/duplicated/template workflows are created DISABLED — enabling is an
 *     explicit, separate act (§4 of the task);
 *   - enabling runs validateWorkflowForEnable and refuses with the issues
 *     list — drafts save in any state, but only valid graphs go live;
 *   - names are unique per repo (auto-generated adjective-noun with
 *     collision retry; duplicates get "name copy"-style dedup via the same
 *     picker).
 */

export interface WorkflowListItem {
	id: string;
	name: string;
	enabled: boolean;
	nodeCount: number;
	/** Trigger event kinds across trigger nodes — the card's summary line. */
	triggerKinds: string[];
	updatedAt: string;
	runnable: boolean;
}

export interface WorkflowRow extends WorkflowListItem {
	definition: WorkflowDefinition;
}

function toListItem(row: {
	id: string;
	name: string;
	enabled: boolean;
	definition: unknown;
	updatedAt: Date;
}): WorkflowListItem {
	const parsed = workflowDefinitionSchema.safeParse(row.definition);
	const nodes = parsed.success ? parsed.data.nodes : [];
	return {
		id: row.id,
		name: row.name,
		enabled: row.enabled,
		nodeCount: nodes.length,
		triggerKinds: [
			...new Set(nodes.flatMap((n) => (n.type === "trigger" ? n.kinds : []))),
		],
		updatedAt: row.updatedAt.toISOString(),
		runnable:
			!(row.enabled && parsed.success) ||
			unrunnableIssues(parsed.data).length === 0,
	};
}

export async function listWorkflows(
	db: Db,
	repoId: string,
): Promise<WorkflowListItem[]> {
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId))
		.orderBy(workflowDefinitions.createdAt);
	return rows.map(toListItem);
}

export async function getWorkflow(
	db: Db,
	input: { repoId: string; workflowId: string },
): Promise<WorkflowRow | null> {
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.id, input.workflowId),
				eq(workflowDefinitions.repoId, input.repoId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) {
		return null;
	}
	const parsed = workflowDefinitionSchema.safeParse(row.definition);
	if (!parsed.success) {
		return null; // a stored-corrupt definition reads as missing, never throws into a route
	}
	return { ...toListItem(row), definition: parsed.data };
}

async function takenNames(db: Db, repoId: string): Promise<Set<string>> {
	const rows = await db
		.select({ name: workflowDefinitions.name })
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId));
	return new Set(rows.map((r) => r.name));
}

/**
 * Create a workflow — DISABLED, auto-named unless a template supplies both.
 * `definition` defaults to an empty-but-valid-enough draft shell: a single
 * trigger node, because the contract requires ≥1 node (drafts stay honest to
 * the wire shape; the editor treats a lone default trigger as "blank").
 */
export async function createWorkflow(
	db: Db,
	input: {
		repoId: string;
		name?: string;
		definition?: WorkflowDefinition;
		seed?: number;
	},
): Promise<WorkflowListItem> {
	const taken = await takenNames(db, input.repoId);
	const name =
		input.name && !taken.has(input.name)
			? input.name
			: pickWorkflowName(input.name ? new Set([...taken, input.name]) : taken, {
					seed: input.seed,
				});
	const definition: WorkflowDefinition = input.definition
		? workflowDefinitionSchema.parse({ ...input.definition, name })
		: {
				id: generateId(),
				name,
				version: 1,
				nodes: [
					{
						id: generateId(),
						type: "trigger",
						kinds: ["change-request.opened"],
						position: { x: 80, y: 120 },
					},
				],
				edges: [],
			};
	const id = generateId();
	const now = new Date();
	await db.insert(workflowDefinitions).values({
		id,
		repoId: input.repoId,
		name,
		enabled: false, // §4: saving never enables; new workflows start OFF
		definition,
		createdAt: now,
		updatedAt: now,
	});
	return toListItem({
		id,
		name,
		enabled: false,
		definition,
		updatedAt: now,
	});
}

/** Update the definition (the editor's save). Never touches `enabled`. */
export async function updateWorkflowDefinition(
	db: Db,
	input: {
		repoId: string;
		workflowId: string;
		definition: WorkflowDefinition;
	},
): Promise<{ ok: boolean }> {
	const valid = workflowDefinitionSchema.parse(input.definition);
	const rows = await db
		.update(workflowDefinitions)
		.set({ definition: valid, name: valid.name, updatedAt: new Date() })
		.where(
			and(
				eq(workflowDefinitions.id, input.workflowId),
				eq(workflowDefinitions.repoId, input.repoId),
			),
		)
		.returning({ id: workflowDefinitions.id });
	return { ok: rows.length > 0 };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function lockWorkflowRow(
	tx: Tx,
	input: { repoId: string; workflowId: string },
) {
	const rows = await tx
		.select()
		.from(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.id, input.workflowId),
				eq(workflowDefinitions.repoId, input.repoId),
			),
		)
		.limit(1)
		.for("update");
	return rows[0] ?? null;
}

export type SaveWorkflowResult =
	| { ok: true }
	| { ok: false; issues: ValidationIssue[] };

export async function saveWorkflowDefinition(
	db: Db,
	input: {
		repoId: string;
		workflowId: string;
		definition: WorkflowDefinition;
	},
): Promise<SaveWorkflowResult> {
	const definition = workflowDefinitionSchema.parse(input.definition);
	const catalog = await repoRuleCatalog(db, input.repoId);
	return await db.transaction(async (tx): Promise<SaveWorkflowResult> => {
		const row = await lockWorkflowRow(tx, input);
		if (!row) {
			return { ok: false, issues: [{ message: "workflow not found" }] };
		}
		if (row.enabled) {
			const checked = validateWorkflowForEnable(definition, catalog);
			if (!checked.valid) {
				return { ok: false, issues: checked.issues };
			}
		}
		await tx
			.update(workflowDefinitions)
			.set({ definition, name: definition.name, updatedAt: new Date() })
			.where(eq(workflowDefinitions.id, row.id));
		return { ok: true };
	});
}

export async function renameWorkflow(
	db: Db,
	input: { repoId: string; workflowId: string; name: string },
): Promise<{ ok: boolean; error?: string }> {
	const name = input.name.trim();
	if (name.length === 0 || name.length > 80) {
		return { ok: false, error: "name must be 1–80 characters" };
	}
	const taken = await takenNames(db, input.repoId);
	if (taken.has(name)) {
		return { ok: false, error: "a workflow with that name already exists" };
	}
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.id, input.workflowId),
				eq(workflowDefinitions.repoId, input.repoId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) {
		return { ok: false, error: "workflow not found" };
	}
	const definition = workflowDefinitionSchema.parse(row.definition);
	await db
		.update(workflowDefinitions)
		.set({
			name,
			definition: { ...definition, name },
			updatedAt: new Date(),
		})
		.where(eq(workflowDefinitions.id, input.workflowId));
	return { ok: true };
}

/** Duplicate — DISABLED regardless of the source's state (§4). */
export async function duplicateWorkflow(
	db: Db,
	input: { repoId: string; workflowId: string; seed?: number },
): Promise<WorkflowListItem | null> {
	const source = await getWorkflow(db, input);
	if (!source) {
		return null;
	}
	const taken = await takenNames(db, input.repoId);
	const name = pickWorkflowName(taken, { seed: input.seed });
	return await createWorkflow(db, {
		repoId: input.repoId,
		name,
		definition: {
			...source.definition,
			id: generateId(), // a fresh wire identity — snapshots must not alias
			name,
		},
	});
}

export async function deleteWorkflow(
	db: Db,
	input: { repoId: string; workflowId: string },
): Promise<{ deleted: boolean }> {
	const rows = await db
		.delete(workflowDefinitions)
		.where(
			and(
				eq(workflowDefinitions.id, input.workflowId),
				eq(workflowDefinitions.repoId, input.repoId),
			),
		)
		.returning({ id: workflowDefinitions.id });
	return { deleted: rows.length > 0 };
}

/**
 * The runtime rule catalog for a repo: built-ins plus its custom rules, so a
 * workflow can gate on either.
 */
export async function repoRuleCatalog(
	db: Db,
	repoId: string,
): Promise<ValidationCatalogEntry[]> {
	const customRows = await db
		.select()
		.from(customRules)
		.where(eq(customRules.repoId, repoId));
	const parsedCustom = customRows.flatMap((raw) => {
		const parsed = customRuleRecordSchema.safeParse(raw);
		return parsed.success ? [parsed.data] : [];
	});
	return resolveCatalog(parsedCustom);
}

/** Every workflow on a repo with its definition. Corrupt rows are skipped. */
export async function listWorkflowRows(
	db: Db,
	repoId: string,
): Promise<WorkflowRow[]> {
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId))
		.orderBy(workflowDefinitions.createdAt);
	return rows.flatMap((row) => {
		const parsed = workflowDefinitionSchema.safeParse(row.definition);
		return parsed.success
			? [{ ...toListItem(row), definition: parsed.data }]
			: [];
	});
}

export type ApplyWorkflowResult =
	| {
			ok: true;
			outcome: "created" | "updated" | "unchanged";
			workflow: WorkflowListItem;
			changes: WorkflowChange[];
	  }
	| { ok: false; issues: ValidationIssue[] };

/**
 * Stores a workflow written as code. It matches an existing workflow by its
 * definition id; a new one starts off, like every new workflow. A live
 * workflow only takes a definition that could be turned on, so a push never
 * leaves broken wiring running.
 */
export async function applyWorkflowDefinition(
	db: Db,
	input: { repoId: string; definition: WorkflowDefinition },
): Promise<ApplyWorkflowResult> {
	const rows = await listWorkflowRows(db, input.repoId);
	const existing = rows.find(
		(row) => row.definition.id === input.definition.id,
	);
	const clash = rows.find(
		(row) => row.name === input.definition.name && row.id !== existing?.id,
	);
	if (clash) {
		return {
			ok: false,
			issues: [
				{
					message: `Another workflow on this repo is named ${input.definition.name}. Pick another name.`,
				},
			],
		};
	}
	if (!existing) {
		const definition = stripWorkflowSecrets(input.definition);
		const workflow = await createWorkflow(db, {
			repoId: input.repoId,
			name: definition.name,
			definition,
		});
		return {
			ok: true,
			outcome: "created",
			workflow,
			changes: diffWorkflow(null, definition),
		};
	}
	const catalog = await repoRuleCatalog(db, input.repoId);
	return await db.transaction(async (tx): Promise<ApplyWorkflowResult> => {
		const locked = await lockWorkflowRow(tx, {
			repoId: input.repoId,
			workflowId: existing.id,
		});
		const stored = workflowDefinitionSchema.safeParse(locked?.definition);
		if (!(locked && stored.success)) {
			return { ok: false, issues: [{ message: "workflow not found" }] };
		}
		const merged = mergeForPush(
			stored.data,
			stripWorkflowSecrets(input.definition),
		);
		const changes = diffWorkflow(stored.data, merged);
		const workflow = {
			...toListItem(locked),
			name: merged.name,
		};
		if (changes.length === 0) {
			return { ok: true, outcome: "unchanged", workflow, changes };
		}
		if (locked.enabled) {
			const checked = validateWorkflowForEnable(merged, catalog);
			if (!checked.valid) {
				return { ok: false, issues: checked.issues };
			}
		}
		await tx
			.update(workflowDefinitions)
			.set({ definition: merged, name: merged.name, updatedAt: new Date() })
			.where(eq(workflowDefinitions.id, locked.id));
		return { ok: true, outcome: "updated", workflow, changes };
	});
}

export type SetEnabledResult =
	| { ok: true; enabled: boolean; warnings?: ValidationIssue[] }
	| { ok: false; issues: ValidationIssue[] };

/**
 * The explicit enable/disable act. Disabling always succeeds; ENABLING runs
 * the strict validator and refuses with the issues list — the UI's job is to
 * show WHY, never a silent failure.
 */
export async function setWorkflowEnabled(
	db: Db,
	input: { repoId: string; workflowId: string; enabled: boolean },
): Promise<SetEnabledResult> {
	const catalog = input.enabled ? await repoRuleCatalog(db, input.repoId) : [];
	const synced = input.enabled
		? await listRepoReviewers(db, input.repoId)
		: null;
	return await db.transaction(async (tx): Promise<SetEnabledResult> => {
		const row = await lockWorkflowRow(tx, input);
		if (!row) {
			return { ok: false, issues: [{ message: "workflow not found" }] };
		}
		let warnings: ValidationIssue[] = [];
		if (input.enabled) {
			const result = validateWorkflowForEnable(row.definition, catalog);
			if (!result.valid) {
				return { ok: false, issues: result.issues };
			}
			warnings = synced?.syncedAt
				? lintWorkflow(result.definition, {
						catalog,
						reviewers: synced.reviewers,
					}).filter((issue) => issue.rule === "stale-reviewer")
				: [];
		}
		await tx
			.update(workflowDefinitions)
			.set({ enabled: input.enabled, updatedAt: new Date() })
			.where(eq(workflowDefinitions.id, row.id));
		return warnings.length > 0
			? { ok: true, enabled: input.enabled, warnings }
			: { ok: true, enabled: input.enabled };
	});
}

/** Repo row id from full name — the worker-side hop kept here for tests. */
export async function repoIdByFullName(
	db: Db,
	fullName: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: repos.id })
		.from(repos)
		.where(eq(repos.fullName, fullName))
		.limit(1);
	return rows[0]?.id ?? null;
}
