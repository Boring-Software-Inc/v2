import {
	type ValidationIssue,
	validateWorkflowForEnable,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId, pickWorkflowName } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { repos, workflowDefinitions } from "../schema/repos.ts";

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

export type SetEnabledResult =
	| { ok: true; enabled: boolean }
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
	if (input.enabled) {
		const row = await getWorkflow(db, input);
		if (!row) {
			return { ok: false, issues: [{ message: "workflow not found" }] };
		}
		const result = validateWorkflowForEnable(row.definition);
		if (!result.valid) {
			return { ok: false, issues: result.issues };
		}
	}
	const rows = await db
		.update(workflowDefinitions)
		.set({ enabled: input.enabled, updatedAt: new Date() })
		.where(
			and(
				eq(workflowDefinitions.id, input.workflowId),
				eq(workflowDefinitions.repoId, input.repoId),
			),
		)
		.returning({ id: workflowDefinitions.id });
	if (rows.length === 0) {
		return { ok: false, issues: [{ message: "workflow not found" }] };
	}
	return { ok: true, enabled: input.enabled };
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
