import {
	catalogWithAiCredits,
	customRuleRecordSchema,
	diffWorkflow,
	ingestForgeSchema,
	issuesInState,
	lintWorkflow,
	mergeForPush,
	reportWorkflows,
	resolveCatalog,
	restartedSchedules,
	scheduleWords,
	stripWorkflowSecrets,
	type ValidationCatalogEntry,
	type ValidationIssue,
	validateWorkflowForEnable,
	type WorkflowChange,
	type WorkflowDefinition,
	type WorkflowReport,
	type WorkflowState,
	workflowDefinitionSchema,
	workflowReadiness,
	workflowState,
} from "@tripwire/contracts";
import { generateId, pickWorkflowName } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
	customRules,
	repos,
	workflowDefinitions,
	workflowScheduleState,
} from "../schema/repos.ts";
import { getAiCredits } from "./ai-provider.ts";
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

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface WorkflowListItem {
	id: string;
	name: string;
	enabled: boolean;
	nodeCount: number;
	/** Trigger event kinds across trigger nodes — the card's summary line. */
	triggerKinds: string[];
	schedules: string[];
	updatedAt: string;
	runnable: boolean;
	canTurnOn: boolean;
	state: WorkflowState;
}

export interface WorkflowRow extends WorkflowListItem {
	definition: WorkflowDefinition;
}

function toListItem(
	row: {
		id: string;
		name: string;
		enabled: boolean;
		definition: unknown;
		updatedAt: Date;
	},
	catalog: readonly ValidationCatalogEntry[],
): WorkflowListItem {
	const parsed = workflowDefinitionSchema.safeParse(row.definition);
	const nodes = parsed.success ? parsed.data.nodes : [];
	const readiness = parsed.success
		? workflowReadiness(parsed.data, catalog)
		: { runnable: false, canTurnOn: false };
	return {
		id: row.id,
		name: row.name,
		enabled: row.enabled,
		nodeCount: nodes.length,
		triggerKinds: [
			...new Set(nodes.flatMap((n) => (n.type === "trigger" ? n.kinds : []))),
		],
		schedules: nodes.flatMap((n) =>
			n.type === "trigger" && n.schedule?.every
				? [
						scheduleWords({
							every: n.schedule.every,
							timezone: n.schedule.timezone,
						}),
					]
				: [],
		),
		updatedAt: row.updatedAt.toISOString(),
		runnable: readiness.runnable,
		canTurnOn: readiness.canTurnOn,
		state: workflowState({ enabled: row.enabled, ...readiness }),
	};
}

export async function listWorkflows(
	db: Executor,
	repoId: string,
): Promise<WorkflowListItem[]> {
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId))
		.orderBy(workflowDefinitions.createdAt);
	const catalog = await repoRuleCatalog(db, repoId);
	return rows.map((row) => toListItem(row, catalog));
}

export async function getWorkflow(
	db: Executor,
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
	return {
		...toListItem(row, await repoRuleCatalog(db, input.repoId)),
		definition: parsed.data,
	};
}

async function takenNames(db: Executor, repoId: string): Promise<Set<string>> {
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
	db: Executor,
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
	return toListItem(
		{ id, name, enabled: false, definition, updatedAt: now },
		await repoRuleCatalog(db, input.repoId),
	);
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

export async function restartSchedules(
	tx: Tx,
	workflowRowId: string,
	before: WorkflowDefinition | null,
	after: WorkflowDefinition,
): Promise<void> {
	for (const restart of restartedSchedules(before, after, new Date())) {
		await tx
			.insert(workflowScheduleState)
			.values({
				workflowId: workflowRowId,
				nodeId: restart.nodeId,
				lastTickAt: restart.lastTickAt,
				lastError: null,
			})
			.onConflictDoUpdate({
				target: [
					workflowScheduleState.workflowId,
					workflowScheduleState.nodeId,
				],
				set: { lastTickAt: restart.lastTickAt, lastError: null },
			});
	}
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
		const stored = workflowDefinitionSchema.safeParse(row.definition);
		if (row.enabled) {
			const issues = liveSaveRefusals(definition, catalog);
			if (issues.length > 0) {
				return { ok: false, issues };
			}
		}
		await tx
			.update(workflowDefinitions)
			.set({ definition, name: definition.name, updatedAt: new Date() })
			.where(eq(workflowDefinitions.id, row.id));
		await restartSchedules(
			tx,
			row.id,
			stored.success ? stored.data : null,
			definition,
		);
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
	db: Executor,
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
	return catalogWithAiCredits(
		resolveCatalog(parsedCustom),
		await getAiCredits(db),
	);
}

/** Every workflow on a repo with its definition. Corrupt rows are skipped. */
export async function listWorkflowRows(
	db: Executor,
	repoId: string,
): Promise<WorkflowRow[]> {
	const rows = await db
		.select()
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId))
		.orderBy(workflowDefinitions.createdAt);
	const catalog = await repoRuleCatalog(db, repoId);
	return rows.flatMap((row) => {
		const parsed = workflowDefinitionSchema.safeParse(row.definition);
		return parsed.success
			? [{ ...toListItem(row, catalog), definition: parsed.data }]
			: [];
	});
}

export function pushedDefinition(
	stored: WorkflowDefinition | null,
	incoming: WorkflowDefinition,
): WorkflowDefinition {
	return mergeForPush(stored, stripWorkflowSecrets(incoming));
}

export interface PushPreview {
	valid: boolean;
	workflows: (WorkflowReport & {
		enabled: boolean;
		changes: WorkflowChange[];
	})[];
}

export async function previewWorkflowPush(
	db: Db,
	input: { repoId: string; definitions: readonly WorkflowDefinition[] },
): Promise<PushPreview> {
	const [catalog, rows] = await Promise.all([
		repoRuleCatalog(db, input.repoId),
		listWorkflowRows(db, input.repoId),
	]);
	const workflows = input.definitions.flatMap((incoming) => {
		const stored =
			rows.find((row) => row.definition.id === incoming.id) ?? null;
		const pushed = pushedDefinition(stored?.definition ?? null, incoming);
		const enabled = stored?.enabled ?? false;
		return reportWorkflows([pushed], catalog).map((report) => ({
			...report,
			issues: issuesInState(report.issues, enabled),
			enabled,
			changes: diffWorkflow(stored?.definition ?? null, pushed),
		}));
	});
	return { valid: workflows.every((entry) => entry.valid), workflows };
}

export type ApplyWorkflowResult =
	| {
			ok: true;
			outcome: "created" | "updated" | "unchanged";
			workflow: WorkflowListItem;
			changes: WorkflowChange[];
	  }
	| {
			ok: false;
			reason: "name-taken" | "live-cannot-run" | "not-found";
			issues: ValidationIssue[];
	  };

/**
 * Stores a workflow written as code. It matches an existing workflow by its
 * definition id; a new one starts off, like every new workflow. A live
 * workflow only takes a definition that could be turned on, so a push never
 * leaves broken wiring running.
 */
export async function applyWorkflowDefinition(
	db: Executor,
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
			reason: "name-taken",
			issues: [
				{
					message: `Another workflow on this repo is named ${input.definition.name}. Pick another name.`,
				},
			],
		};
	}
	if (!existing) {
		const definition = pushedDefinition(null, input.definition);
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
			return {
				ok: false,
				reason: "not-found",
				issues: [{ message: "workflow not found" }],
			};
		}
		const merged = pushedDefinition(stored.data, input.definition);
		const changes = diffWorkflow(stored.data, merged);
		const workflow = {
			...toListItem(locked, catalog),
			name: merged.name,
		};
		if (changes.length === 0) {
			return { ok: true, outcome: "unchanged", workflow, changes };
		}
		if (locked.enabled) {
			const issues = liveSaveRefusals(merged, catalog);
			if (issues.length > 0) {
				return { ok: false, reason: "live-cannot-run", issues };
			}
		}
		await tx
			.update(workflowDefinitions)
			.set({ definition: merged, name: merged.name, updatedAt: new Date() })
			.where(eq(workflowDefinitions.id, locked.id));
		await restartSchedules(tx, locked.id, stored.data, merged);
		return { ok: true, outcome: "updated", workflow, changes };
	});
}

export function liveSaveRefusals(
	next: WorkflowDefinition,
	catalog: readonly ValidationCatalogEntry[],
): ValidationIssue[] {
	const checked = validateWorkflowForEnable(next, catalog);
	return checked.valid ? [] : checked.issues;
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
			const [repo] = await tx
				.select({ forge: repos.forge })
				.from(repos)
				.where(eq(repos.id, input.repoId));
			if (!repo || !ingestForgeSchema.safeParse(repo.forge).success)
				return {
					ok: false,
					issues: [{ message: "Protection is unavailable for this forge" }],
				};
			const result = validateWorkflowForEnable(row.definition, catalog);
			if (!result.valid) {
				return { ok: false, issues: result.issues };
			}
			if (!row.enabled) {
				await restartSchedules(tx, row.id, null, result.definition);
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
