import {
	AGENT_SESSION_HOLD_MS,
	type AgentNodeTouch,
	type AgentPresence,
	agentNodeTouchesSchema,
	changeSetSize,
	mergeTouches,
	redactWorkflowSecrets,
	releaseTouches,
	touchesFromChangeSet,
	type ValidationIssue,
	WORKFLOW_DRAFT_TTL_MS,
	type WorkflowChangeSet,
	type WorkflowDefinition,
	type WorkflowDraftView,
	type WorkflowWork,
	workflowChangeSet,
	workflowChangeSetSchema,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId, pickWorkflowName } from "@tripwire/utils";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { agentActivity, workflowDrafts } from "../schema/agent-work.ts";
import { oauthClient } from "../schema/oauth.ts";
import { repos } from "../schema/repos.ts";
import { notifyLive } from "./live-notify.ts";
import {
	type ApplyWorkflowResult,
	applyWorkflowDefinition,
	type Executor,
	getWorkflow,
	listWorkflowRows,
	listWorkflows,
	pushedDefinition,
	type Tx,
	type WorkflowListItem,
	type WorkflowRow,
} from "./workflows.ts";

export interface WorkAgent {
	userId: string;
	clientId: string;
}

export interface WorkflowCard extends WorkflowListItem {
	draftId: string | null;
	work: WorkflowWork | null;
}

export interface WorkflowWorkDetail extends WorkflowRow {
	draftId: string | null;
	work: WorkflowWork | null;
}

type DraftRow = typeof workflowDrafts.$inferSelect;
type ActivityRow = typeof agentActivity.$inferSelect;

const AGENT_FALLBACK_NAME = "Your agent";

function draftDefinition(
	row: Pick<DraftRow, "definition">,
): WorkflowDefinition | null {
	const parsed = workflowDefinitionSchema.safeParse(row.definition);
	return parsed.success ? parsed.data : null;
}

function draftChange(
	row: Pick<DraftRow, "lastChange">,
): WorkflowChangeSet | null {
	const parsed = workflowChangeSetSchema.safeParse(row.lastChange);
	return parsed.success ? parsed.data : null;
}

function activityTouches(row: Pick<ActivityRow, "nodes">): AgentNodeTouch[] {
	const parsed = agentNodeTouchesSchema.safeParse(row.nodes);
	return parsed.success ? parsed.data : [];
}

function draftView(row: DraftRow): WorkflowDraftView {
	const definition = draftDefinition(row);
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		definition: definition ? redactWorkflowSecrets(definition) : null,
		revision: row.revision,
		lastChange: draftChange(row),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
	};
}

function presence(row: ActivityRow, name: string | null): AgentPresence {
	return {
		userId: row.userId,
		clientId: row.clientId,
		name: name?.trim() || AGENT_FALLBACK_NAME,
		lastSignalAt: row.lastSignalAt.toISOString(),
		finishedAt: row.finishedAt?.toISOString() ?? null,
		nodes: activityTouches(row),
	};
}

function isLiveDraft(row: DraftRow, now: Date): boolean {
	return row.status === "open" && row.expiresAt > now;
}

async function openDraft(
	db: Executor,
	input: { repoId: string; definitionId: string },
	now: Date,
): Promise<DraftRow | null> {
	const rows = await db
		.select()
		.from(workflowDrafts)
		.where(
			and(
				eq(workflowDrafts.repoId, input.repoId),
				eq(workflowDrafts.definitionId, input.definitionId),
				eq(workflowDrafts.status, "open"),
				gt(workflowDrafts.expiresAt, now),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

async function recentAgents(
	db: Db,
	input: { repoId: string; definitionIds?: readonly string[] },
	now: Date,
): Promise<{ row: ActivityRow; name: string | null }[]> {
	const since = new Date(now.getTime() - AGENT_SESSION_HOLD_MS);
	const filters = [
		eq(agentActivity.repoId, input.repoId),
		gt(agentActivity.lastSignalAt, since),
	];
	if (input.definitionIds) {
		if (input.definitionIds.length === 0) {
			return [];
		}
		filters.push(inArray(agentActivity.definitionId, [...input.definitionIds]));
	}
	return await db
		.select({ row: agentActivity, name: oauthClient.name })
		.from(agentActivity)
		.leftJoin(oauthClient, eq(oauthClient.clientId, agentActivity.clientId))
		.where(and(...filters))
		.orderBy(agentActivity.startedAt);
}

async function workflowRowByDefinition(
	db: Executor,
	repoId: string,
	definitionId: string,
): Promise<WorkflowRow | null> {
	const rows = await listWorkflowRows(db, repoId);
	return rows.find((row) => row.definition.id === definitionId) ?? null;
}

/** Everything a viewer needs to draw one workflow's live state. */
export async function getWorkflowWork(
	db: Db,
	input: { repoId: string; definitionId: string; now?: Date },
): Promise<WorkflowWork> {
	const now = input.now ?? new Date();
	const drafts = await db
		.select()
		.from(workflowDrafts)
		.where(
			and(
				eq(workflowDrafts.repoId, input.repoId),
				eq(workflowDrafts.definitionId, input.definitionId),
			),
		)
		.orderBy(desc(workflowDrafts.updatedAt))
		.limit(1);
	const latest = drafts[0] ?? null;
	const draft =
		latest && (latest.status !== "open" || isLiveDraft(latest, now))
			? latest
			: null;
	const stored = draft?.workflowId
		? draft.workflowId
		: ((await workflowRowByDefinition(db, input.repoId, input.definitionId))
				?.id ?? null);
	const agents = await recentAgents(
		db,
		{ repoId: input.repoId, definitionIds: [input.definitionId] },
		now,
	);
	return {
		repoId: input.repoId,
		definitionId: input.definitionId,
		workflowId: stored,
		draft: draft ? draftView(draft) : null,
		agents: agents.map(({ row, name }) => presence(row, name)),
	};
}

export async function listRepoWork(
	db: Db,
	input: { repoId: string; now?: Date },
): Promise<WorkflowWork[]> {
	const now = input.now ?? new Date();
	const drafts = await db
		.select()
		.from(workflowDrafts)
		.where(
			and(
				eq(workflowDrafts.repoId, input.repoId),
				eq(workflowDrafts.status, "open"),
				gt(workflowDrafts.expiresAt, now),
			),
		)
		.orderBy(workflowDrafts.createdAt);
	const agents = await recentAgents(db, { repoId: input.repoId }, now);
	const ids = [
		...new Set([
			...drafts.map((draft) => draft.definitionId),
			...agents.map(({ row }) => row.definitionId),
		]),
	];
	return ids.map((definitionId) => {
		const draft = drafts.find((row) => row.definitionId === definitionId);
		return {
			repoId: input.repoId,
			definitionId,
			workflowId: draft?.workflowId ?? null,
			draft: draft ? draftView(draft) : null,
			agents: agents
				.filter(({ row }) => row.definitionId === definitionId)
				.map(({ row, name }) => presence(row, name)),
		};
	});
}

function blankDefinition(id: string, name: string): WorkflowDefinition {
	return { id, name, version: 1, nodes: [], edges: [] };
}

function draftOnlyRow(draft: DraftRow): WorkflowRow {
	const definition =
		draftDefinition(draft) ?? blankDefinition(draft.definitionId, draft.name);
	return {
		id: draft.id,
		name: draft.name,
		enabled: false,
		nodeCount: definition.nodes.length,
		triggerKinds: [
			...new Set(
				definition.nodes.flatMap((n) => (n.type === "trigger" ? n.kinds : [])),
			),
		],
		schedules: [],
		updatedAt: draft.updatedAt.toISOString(),
		runnable: false,
		canTurnOn: false,
		state: "off",
		definition: redactWorkflowSecrets(definition),
	};
}

/** The workflows page: saved workflows, then drafts of new ones. */
export async function listWorkflowCards(
	db: Db,
	input: { repoId: string; now?: Date },
): Promise<WorkflowCard[]> {
	const now = input.now ?? new Date();
	const [items, rows, work, drafts] = await Promise.all([
		listWorkflows(db, input.repoId),
		listWorkflowRows(db, input.repoId),
		listRepoWork(db, { repoId: input.repoId, now }),
		db
			.select()
			.from(workflowDrafts)
			.where(
				and(
					eq(workflowDrafts.repoId, input.repoId),
					eq(workflowDrafts.status, "open"),
					gt(workflowDrafts.expiresAt, now),
				),
			)
			.orderBy(workflowDrafts.createdAt),
	]);
	const definitionOf = new Map(rows.map((row) => [row.id, row.definition.id]));
	const saved = items.map((item) => {
		const definitionId = definitionOf.get(item.id);
		const found = work.find((entry) => entry.definitionId === definitionId);
		return {
			...item,
			draftId: found?.draft?.id ?? null,
			work: found ? { ...found, workflowId: item.id } : null,
		};
	});
	const savedDefinitions = new Set(definitionOf.values());
	const fresh = drafts
		.filter((draft) => !savedDefinitions.has(draft.definitionId))
		.map((draft) => {
			const { definition: _definition, ...item } = draftOnlyRow(draft);
			return {
				...item,
				draftId: draft.id,
				work:
					work.find((entry) => entry.definitionId === draft.definitionId) ??
					null,
			};
		});
	return [...saved, ...fresh];
}

/**
 * The editor's read: a saved workflow, or an open draft of a new one by its
 * draft id. A saved workflow with an open draft shows the draft.
 */
export async function getWorkflowWithWork(
	db: Db,
	input: { repoId: string; workflowId: string; now?: Date },
): Promise<WorkflowWorkDetail | null> {
	const now = input.now ?? new Date();
	const saved = await getWorkflow(db, input);
	if (saved) {
		const work = await getWorkflowWork(db, {
			repoId: input.repoId,
			definitionId: saved.definition.id,
			now,
		});
		return {
			...saved,
			draftId: work.draft?.status === "open" ? work.draft.id : null,
			work: { ...work, workflowId: saved.id },
		};
	}
	const rows = await db
		.select()
		.from(workflowDrafts)
		.where(
			and(
				eq(workflowDrafts.id, input.workflowId),
				eq(workflowDrafts.repoId, input.repoId),
			),
		)
		.limit(1);
	const draft = rows[0];
	if (!draft) {
		return null;
	}
	if (draft.status === "promoted" && draft.workflowId) {
		return await getWorkflowWithWork(db, {
			...input,
			workflowId: draft.workflowId,
			now,
		});
	}
	if (!isLiveDraft(draft, now)) {
		return null;
	}
	const work = await getWorkflowWork(db, {
		repoId: input.repoId,
		definitionId: draft.definitionId,
		now,
	});
	return { ...draftOnlyRow(draft), draftId: draft.id, work };
}

async function withDraftLock<T>(
	db: Db,
	key: { repoId: string; definitionId: string },
	work: (tx: Tx) => Promise<T>,
): Promise<T> {
	const lockKey = `workflow-draft:${key.repoId}:${key.definitionId}`;
	return await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
		);
		return await work(tx);
	});
}

async function touch(
	db: Executor,
	input: {
		repoId: string;
		definitionId: string;
		agent: WorkAgent;
		touches: readonly AgentNodeTouch[];
		now: Date;
	},
): Promise<void> {
	const existing = await db
		.select()
		.from(agentActivity)
		.where(
			and(
				eq(agentActivity.repoId, input.repoId),
				eq(agentActivity.definitionId, input.definitionId),
				eq(agentActivity.userId, input.agent.userId),
				eq(agentActivity.clientId, input.agent.clientId),
			),
		)
		.limit(1);
	const row = existing[0];
	const fresh =
		row &&
		row.finishedAt === null &&
		input.now.getTime() - row.lastSignalAt.getTime() < AGENT_SESSION_HOLD_MS;
	const nodes = agentNodeTouchesSchema.parse(
		mergeTouches(fresh ? activityTouches(row) : [], input.touches, input.now),
	);
	if (!row) {
		await db
			.insert(agentActivity)
			.values({
				id: generateId(),
				repoId: input.repoId,
				definitionId: input.definitionId,
				userId: input.agent.userId,
				clientId: input.agent.clientId,
				nodes,
				startedAt: input.now,
				lastSignalAt: input.now,
			})
			.onConflictDoUpdate({
				target: [
					agentActivity.repoId,
					agentActivity.definitionId,
					agentActivity.userId,
					agentActivity.clientId,
				],
				set: { nodes, lastSignalAt: input.now, finishedAt: null },
			});
		return;
	}
	await db
		.update(agentActivity)
		.set({
			nodes,
			lastSignalAt: input.now,
			finishedAt: null,
			startedAt: fresh ? row.startedAt : input.now,
		})
		.where(eq(agentActivity.id, row.id));
}

async function writeDraft(
	db: Executor,
	input: {
		repoId: string;
		definitionId: string;
		workflowId: string | null;
		name: string;
		definition: WorkflowDefinition | null;
		change: WorkflowChangeSet | null;
		agent: WorkAgent;
		now: Date;
	},
): Promise<DraftRow> {
	const expiresAt = new Date(input.now.getTime() + WORKFLOW_DRAFT_TTL_MS);
	const current = await openDraft(db, input, input.now);
	if (current) {
		const changed = input.change ? changeSetSize(input.change) > 0 : false;
		const updated = await db
			.update(workflowDrafts)
			.set({
				name: input.name,
				definition: input.definition ?? current.definition,
				workflowId: input.workflowId ?? current.workflowId,
				revision: changed ? current.revision + 1 : current.revision,
				lastChange: changed ? input.change : current.lastChange,
				agentClientId: input.agent.clientId,
				updatedAt: input.now,
				expiresAt,
			})
			.where(eq(workflowDrafts.id, current.id))
			.returning();
		return updated[0] ?? current;
	}
	await db
		.update(workflowDrafts)
		.set({ status: "discarded", updatedAt: input.now })
		.where(
			and(
				eq(workflowDrafts.repoId, input.repoId),
				eq(workflowDrafts.definitionId, input.definitionId),
				eq(workflowDrafts.status, "open"),
			),
		);
	const inserted = await db
		.insert(workflowDrafts)
		.values({
			id: generateId(),
			repoId: input.repoId,
			definitionId: input.definitionId,
			workflowId: input.workflowId,
			name: input.name,
			definition: input.definition,
			revision: input.change && changeSetSize(input.change) > 0 ? 1 : 0,
			lastChange: input.change,
			createdByUserId: input.agent.userId,
			agentClientId: input.agent.clientId,
			createdAt: input.now,
			updatedAt: input.now,
			expiresAt,
		})
		.returning();
	const row = inserted[0];
	if (!row) {
		throw new Error("Tripwire could not save the draft.");
	}
	return row;
}

async function takenNames(db: Executor, repoId: string, now: Date) {
	const [saved, drafts] = await Promise.all([
		listWorkflows(db, repoId),
		db
			.select({ name: workflowDrafts.name })
			.from(workflowDrafts)
			.where(
				and(
					eq(workflowDrafts.repoId, repoId),
					eq(workflowDrafts.status, "open"),
					gt(workflowDrafts.expiresAt, now),
				),
			),
	]);
	return new Set([
		...saved.map((row) => row.name),
		...drafts.map((d) => d.name),
	]);
}

export interface BeginWorkResult {
	definitionId: string;
	workflowId: string | null;
	draftId: string;
	name: string;
}

/**
 * An agent says it is starting. A new workflow gets an empty draft at once;
 * an existing one gets a draft copy, and the listed nodes show as read.
 */
export async function beginWorkflowWork(
	db: Db,
	input: {
		repoId: string;
		agent: WorkAgent;
		workflow?: string;
		name?: string;
		nodeIds?: readonly string[];
		now?: Date;
	},
): Promise<BeginWorkResult> {
	const now = input.now ?? new Date();
	const rows = input.workflow ? await listWorkflowRows(db, input.repoId) : [];
	const stored =
		rows.find(
			(row) =>
				row.id === input.workflow || row.definition.id === input.workflow,
		) ?? null;
	const definitionId = stored?.definition.id ?? input.workflow ?? generateId();
	return await withDraftLock(
		db,
		{ repoId: input.repoId, definitionId },
		async (tx) => {
			const saved = stored
				? await workflowRowByDefinition(tx, input.repoId, definitionId)
				: null;
			const existing = await openDraft(
				tx,
				{ repoId: input.repoId, definitionId },
				now,
			);
			const name =
				existing?.name ??
				saved?.name ??
				(input.name?.trim() ||
					pickWorkflowName(await takenNames(tx, input.repoId, now)));
			const draft = await writeDraft(tx, {
				repoId: input.repoId,
				definitionId,
				workflowId: saved?.id ?? null,
				name,
				definition: existing ? null : (saved?.definition ?? null),
				change: null,
				agent: input.agent,
				now,
			});
			await touch(tx, {
				repoId: input.repoId,
				definitionId,
				agent: input.agent,
				touches: (input.nodeIds ?? []).map((id) => ({
					id,
					action: "read",
					at: now.toISOString(),
				})),
				now,
			});
			await notifyLive(tx, {
				type: "work",
				repoId: input.repoId,
				definitionId,
			});
			return {
				definitionId,
				workflowId: saved?.id ?? null,
				draftId: draft.id,
				name: draft.name,
			};
		},
	);
}

export interface DraftSignalResult {
	draftId: string;
	definitionId: string;
	workflowId: string | null;
	change: WorkflowChangeSet;
}

/**
 * A checked definition becomes the draft. The change against the last draft
 * (or the saved workflow) marks the nodes the agent wrote, edited or removed.
 */
export async function saveAgentDraft(
	db: Db,
	input: {
		repoId: string;
		agent: WorkAgent;
		definition: WorkflowDefinition;
		now?: Date;
	},
): Promise<DraftSignalResult> {
	const now = input.now ?? new Date();
	const definitionId = input.definition.id;
	return await withDraftLock(
		db,
		{ repoId: input.repoId, definitionId },
		async (tx) => {
			const stored = await workflowRowByDefinition(
				tx,
				input.repoId,
				definitionId,
			);
			const current = await openDraft(
				tx,
				{ repoId: input.repoId, definitionId },
				now,
			);
			const previous =
				(current ? draftDefinition(current) : null) ??
				stored?.definition ??
				null;
			const next = pushedDefinition(
				stored?.definition ?? null,
				input.definition,
			);
			const change = workflowChangeSet(previous, next);
			const draft = await writeDraft(tx, {
				repoId: input.repoId,
				definitionId,
				workflowId: stored?.id ?? null,
				name: next.name,
				definition: next,
				change,
				agent: input.agent,
				now,
			});
			await touch(tx, {
				repoId: input.repoId,
				definitionId,
				agent: input.agent,
				touches: touchesFromChangeSet(change, now),
				now,
			});
			await notifyLive(tx, {
				type: "work",
				repoId: input.repoId,
				definitionId,
			});
			return {
				draftId: draft.id,
				definitionId,
				workflowId: stored?.id ?? null,
				change,
			};
		},
	);
}

async function closeDraft(
	db: Executor,
	input: {
		draft: DraftRow;
		status: "promoted" | "discarded";
		workflowId?: string;
		definition?: WorkflowDefinition;
		change?: WorkflowChangeSet;
		now: Date;
	},
): Promise<void> {
	const changed = input.change ? changeSetSize(input.change) > 0 : false;
	await db
		.update(workflowDrafts)
		.set({
			status: input.status,
			workflowId: input.workflowId ?? input.draft.workflowId,
			definition: input.definition ?? input.draft.definition,
			revision: changed ? input.draft.revision + 1 : input.draft.revision,
			lastChange: changed ? input.change : input.draft.lastChange,
			updatedAt: input.now,
		})
		.where(eq(workflowDrafts.id, input.draft.id));
}

export type AgentApplyResult = ApplyWorkflowResult & {
	draftId: string | null;
};

/**
 * The agent's save. It stores the workflow the way apply_workflow always
 * has (a new one stays off) and promotes the open draft.
 */
export async function applyAgentWorkflow(
	db: Db,
	input: {
		repoId: string;
		agent: WorkAgent;
		definition: WorkflowDefinition;
		now?: Date;
	},
): Promise<AgentApplyResult> {
	const now = input.now ?? new Date();
	const definitionId = input.definition.id;
	return await withDraftLock(
		db,
		{ repoId: input.repoId, definitionId },
		async (tx) => {
			const before = await workflowRowByDefinition(
				tx,
				input.repoId,
				definitionId,
			);
			const draft = await openDraft(
				tx,
				{ repoId: input.repoId, definitionId },
				now,
			);
			const result = await applyWorkflowDefinition(tx, {
				repoId: input.repoId,
				definition: input.definition,
			});
			if (!result.ok) {
				return { ...result, draftId: draft?.id ?? null };
			}
			const after = await getWorkflow(tx, {
				repoId: input.repoId,
				workflowId: result.workflow.id,
			});
			const previous =
				(draft ? draftDefinition(draft) : null) ?? before?.definition ?? null;
			const change = after
				? workflowChangeSet(previous, after.definition)
				: workflowChangeSet(previous, input.definition);
			if (draft) {
				await closeDraft(tx, {
					draft,
					status: "promoted",
					workflowId: result.workflow.id,
					definition: after?.definition,
					change,
					now,
				});
			}
			await touch(tx, {
				repoId: input.repoId,
				definitionId,
				agent: input.agent,
				touches: touchesFromChangeSet(change, now),
				now,
			});
			await notifyLive(tx, {
				type: "work",
				repoId: input.repoId,
				definitionId,
			});
			return { ...result, draftId: draft?.id ?? null };
		},
	);
}

/**
 * A person accepted a push review. Each saved workflow promotes its open
 * draft, the same way the agent's apply does.
 */
export async function promoteSavedDrafts(
	db: Db,
	input: {
		repoId: string;
		saved: readonly { definitionId: string; workflowId: string }[];
		now?: Date;
	},
): Promise<string[]> {
	const now = input.now ?? new Date();
	const promoted: string[] = [];
	for (const { definitionId, workflowId } of input.saved) {
		const draftId = await withDraftLock(
			db,
			{ repoId: input.repoId, definitionId },
			async (tx) => {
				const draft = await openDraft(
					tx,
					{ repoId: input.repoId, definitionId },
					now,
				);
				if (!draft) {
					return null;
				}
				const after = await getWorkflow(tx, {
					repoId: input.repoId,
					workflowId,
				});
				await closeDraft(tx, {
					draft,
					status: "promoted",
					workflowId,
					definition: after?.definition,
					change: after
						? workflowChangeSet(draftDefinition(draft), after.definition)
						: undefined,
					now,
				});
				await notifyLive(tx, {
					type: "work",
					repoId: input.repoId,
					definitionId,
				});
				return draft.id;
			},
		);
		if (draftId) {
			promoted.push(draftId);
		}
	}
	return promoted;
}

/** Releases the listed nodes, or every node and the session when none. */
export async function finishWorkflowWork(
	db: Db,
	input: {
		repoId: string;
		agent: WorkAgent;
		workflow?: string;
		nodeIds?: readonly string[];
		now?: Date;
	},
): Promise<{ released: number }> {
	const now = input.now ?? new Date();
	let definitionIds: string[] | null = null;
	if (input.workflow) {
		const stored = (await listWorkflowRows(db, input.repoId)).find(
			(row) => row.id === input.workflow,
		);
		const draft = (
			await db
				.select({ definitionId: workflowDrafts.definitionId })
				.from(workflowDrafts)
				.where(
					and(
						eq(workflowDrafts.repoId, input.repoId),
						eq(workflowDrafts.id, input.workflow),
					),
				)
				.limit(1)
		)[0];
		definitionIds = [
			stored?.definition.id ?? draft?.definitionId ?? input.workflow,
		];
	}
	const filters = [
		eq(agentActivity.repoId, input.repoId),
		eq(agentActivity.userId, input.agent.userId),
		eq(agentActivity.clientId, input.agent.clientId),
		isNull(agentActivity.finishedAt),
	];
	if (definitionIds) {
		filters.push(inArray(agentActivity.definitionId, definitionIds));
	}
	const rows = await db
		.select()
		.from(agentActivity)
		.where(and(...filters));
	for (const row of rows) {
		await withDraftLock(
			db,
			{ repoId: input.repoId, definitionId: row.definitionId },
			async (tx) => {
				const held = await tx
					.select()
					.from(agentActivity)
					.where(eq(agentActivity.id, row.id))
					.limit(1);
				const nodes = releaseTouches(
					activityTouches(held[0] ?? row),
					input.nodeIds,
				);
				await tx
					.update(agentActivity)
					.set({ nodes, finishedAt: input.nodeIds ? null : now })
					.where(eq(agentActivity.id, row.id));
				await notifyLive(tx, {
					type: "work",
					repoId: input.repoId,
					definitionId: row.definitionId,
				});
			},
		);
	}
	return { released: rows.length };
}

export type DraftDecisionResult =
	| { ok: true; workflowId: string }
	| { ok: false; issues: ValidationIssue[] };

async function draftById(
	db: Executor,
	repoId: string,
	draftId: string,
	now: Date,
) {
	const rows = await db
		.select()
		.from(workflowDrafts)
		.where(
			and(eq(workflowDrafts.id, draftId), eq(workflowDrafts.repoId, repoId)),
		)
		.limit(1);
	const row = rows[0];
	return row && isLiveDraft(row, now) ? row : null;
}

/**
 * A person keeps the draft. A new workflow is saved off; a live one swaps
 * in the draft only when it could be turned on.
 */
export async function promoteDraft(
	db: Db,
	input: { repoId: string; draftId: string; now?: Date },
): Promise<DraftDecisionResult> {
	const now = input.now ?? new Date();
	const found = await draftById(db, input.repoId, input.draftId, now);
	if (!found) {
		return { ok: false, issues: [{ message: "This draft is gone." }] };
	}
	return await withDraftLock(db, found, async (tx) => {
		const draft = await draftById(tx, input.repoId, input.draftId, now);
		if (!draft) {
			return { ok: false, issues: [{ message: "This draft is gone." }] };
		}
		const definition = draftDefinition(draft);
		if (!definition || definition.nodes.length === 0) {
			return {
				ok: false,
				issues: [{ message: "This draft has no steps yet." }],
			};
		}
		const result = await applyWorkflowDefinition(tx, {
			repoId: input.repoId,
			definition,
		});
		if (!result.ok) {
			return { ok: false, issues: result.issues };
		}
		await closeDraft(tx, {
			draft,
			status: "promoted",
			workflowId: result.workflow.id,
			now,
		});
		await notifyLive(tx, {
			type: "work",
			repoId: input.repoId,
			definitionId: draft.definitionId,
		});
		return { ok: true, workflowId: result.workflow.id };
	});
}

export async function discardDraft(
	db: Db,
	input: { repoId: string; draftId: string; now?: Date },
): Promise<{ discarded: boolean }> {
	const now = input.now ?? new Date();
	const found = await draftById(db, input.repoId, input.draftId, now);
	if (!found) {
		return { discarded: false };
	}
	return await withDraftLock(db, found, async (tx) => {
		const draft = await draftById(tx, input.repoId, input.draftId, now);
		if (!draft) {
			return { discarded: false };
		}
		await closeDraft(tx, { draft, status: "discarded", now });
		await notifyLive(tx, {
			type: "work",
			repoId: input.repoId,
			definitionId: draft.definitionId,
		});
		return { discarded: true };
	});
}

export async function repoFullNameOf(
	db: Db,
	repoId: string,
): Promise<string | null> {
	const rows = await db
		.select({ fullName: repos.fullName })
		.from(repos)
		.where(eq(repos.id, repoId))
		.limit(1);
	return rows[0]?.fullName ?? null;
}
