import { createHash } from "node:crypto";
import {
	effectivePushStatus,
	issuesInState,
	type LintResult,
	pushBlockingIssues,
	redactWorkflowSecrets,
	reportWorkflows,
	stripWorkflowSecrets,
	type ValidationCatalogEntry,
	type ValidationIssue,
	validationIssueText,
	WORKFLOW_PUSH_TTL_MS,
	type WorkflowDefinition,
	type WorkflowPushChange,
	type WorkflowPushDecision,
	type WorkflowPushEntry,
	type WorkflowPushOutcome,
	type WorkflowPushStatus,
	workflowDefinitionSchema,
	workflowPushEntriesSchema,
	workflowPushOutcomesSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import { repos, workflowDefinitions } from "../schema/repos.ts";
import { workflowPushProposals } from "../schema/workflow-pushes.ts";
import {
	listWorkflowRows,
	liveSaveRefusals,
	type PushPreview,
	previewWorkflowPush,
	pushedDefinition,
	repoRuleCatalog,
	restartSchedules,
	type Tx,
	type WorkflowRow,
} from "./workflows.ts";

export function definitionHash(definition: WorkflowDefinition): string {
	return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

export interface PushBlock {
	id: string;
	name: string;
	issues: string[];
}

export interface WorkflowPushRecord {
	id: string;
	orgId: string;
	repoId: string;
	repoName: string;
	repoFullName: string;
	authorId: string;
	authorName: string;
	status: WorkflowPushStatus;
	createdAt: Date;
	expiresAt: Date;
	decidedAt: Date | null;
	decidedByName: string | null;
	entries: WorkflowPushEntry[];
	outcomes: WorkflowPushOutcome[];
}

export type ProposeWorkflowPushResult =
	| { ok: true; kind: "unchanged" }
	| { ok: true; kind: "proposed"; push: WorkflowPushRecord }
	| { ok: false; reason: "blocked"; blocks: PushBlock[] };

function nameClash(
	definition: WorkflowDefinition,
	rows: readonly { id: string; name: string; definition: { id: string } }[],
	others: readonly WorkflowDefinition[],
): string | null {
	const taken =
		rows.some(
			(row) =>
				row.name === definition.name && row.definition.id !== definition.id,
		) ||
		others.some(
			(other) => other.id !== definition.id && other.name === definition.name,
		);
	return taken
		? `Another workflow on this repo is named ${definition.name}. Pick another name.`
		: null;
}

function previewBlocks(
	preview: PushPreview,
	definitions: readonly WorkflowDefinition[],
	rows: readonly WorkflowRow[],
): PushBlock[] {
	return preview.workflows.flatMap((entry) => {
		const definition = definitions.find((item) => item.id === entry.id);
		const clash = definition ? nameClash(definition, rows, definitions) : null;
		const issues = [
			...(clash ? [clash] : []),
			...pushBlockingIssues(entry.issues, entry.enabled).map(
				validationIssueText,
			),
		];
		return issues.length > 0
			? [{ id: entry.id, name: entry.name, issues }]
			: [];
	});
}

export async function proposeWorkflowPush(
	db: Db,
	input: {
		orgId: string;
		repoId: string;
		authorId: string;
		definitions: readonly WorkflowDefinition[];
		now?: Date;
	},
): Promise<ProposeWorkflowPushResult> {
	const now = input.now ?? new Date();
	const [preview, rows] = await Promise.all([
		previewWorkflowPush(db, {
			repoId: input.repoId,
			definitions: input.definitions,
		}),
		listWorkflowRows(db, input.repoId),
	]);
	const changedIds = new Set(
		preview.workflows
			.filter((entry) => entry.changes.length > 0)
			.map((entry) => entry.id),
	);
	const changed = input.definitions.filter((definition) =>
		changedIds.has(definition.id),
	);
	if (changed.length === 0) {
		return { ok: true, kind: "unchanged" };
	}
	const blocks = previewBlocks(
		{
			...preview,
			workflows: preview.workflows.filter((entry) => changedIds.has(entry.id)),
		},
		input.definitions,
		rows,
	);
	if (blocks.length > 0) {
		return { ok: false, reason: "blocked", blocks };
	}
	const entries: WorkflowPushEntry[] = changed.map((definition) => {
		const base = rows.find((row) => row.definition.id === definition.id);
		return {
			definition: stripWorkflowSecrets(definition),
			baseWorkflowId: base?.id ?? null,
			baseHash: base ? definitionHash(base.definition) : null,
			baseDefinition: base ? redactWorkflowSecrets(base.definition) : null,
		};
	});
	const id = generateId();
	await db.insert(workflowPushProposals).values({
		id,
		orgId: input.orgId,
		repoId: input.repoId,
		authorId: input.authorId,
		entries: workflowPushEntriesSchema.parse(entries),
		status: "pending",
		expiresAt: new Date(now.getTime() + WORKFLOW_PUSH_TTL_MS),
		createdAt: now,
	});
	const push = await getWorkflowPush(db, {
		orgId: input.orgId,
		pushId: id,
		now,
	});
	if (!push) {
		throw new Error("workflow push vanished after insert");
	}
	return { ok: true, kind: "proposed", push };
}

function drifted(
	entry: WorkflowPushEntry,
	rows: readonly { id: string; definition: WorkflowDefinition }[],
): boolean {
	if (entry.baseWorkflowId === null) {
		return rows.some((row) => row.definition.id === entry.definition.id);
	}
	const row = rows.find((item) => item.id === entry.baseWorkflowId);
	return !row || definitionHash(row.definition) !== entry.baseHash;
}

export async function getWorkflowPush(
	db: Db,
	input: { orgId: string; pushId: string; now?: Date },
): Promise<WorkflowPushRecord | null> {
	const rows = await db
		.select({
			push: workflowPushProposals,
			repoName: repos.name,
			repoFullName: repos.fullName,
			authorName: user.name,
		})
		.from(workflowPushProposals)
		.innerJoin(repos, eq(repos.id, workflowPushProposals.repoId))
		.innerJoin(user, eq(user.id, workflowPushProposals.authorId))
		.where(
			and(
				eq(workflowPushProposals.id, input.pushId),
				eq(workflowPushProposals.orgId, input.orgId),
			),
		)
		.limit(1);
	const found = rows[0];
	if (!found) {
		return null;
	}
	const { push } = found;
	const entries = workflowPushEntriesSchema.parse(push.entries);
	const stored =
		push.status === "pending" ? await listWorkflowRows(db, push.repoId) : [];
	const decider = push.decidedBy
		? await db
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, push.decidedBy))
				.limit(1)
		: [];
	return {
		id: push.id,
		orgId: push.orgId,
		repoId: push.repoId,
		repoName: found.repoName,
		repoFullName: found.repoFullName,
		authorId: push.authorId,
		authorName: found.authorName,
		status: effectivePushStatus({
			status: push.status,
			expiresAt: push.expiresAt,
			now: input.now ?? new Date(),
			drifted: entries.some((entry) => drifted(entry, stored)),
		}),
		createdAt: push.createdAt,
		expiresAt: push.expiresAt,
		decidedAt: push.decidedAt,
		decidedByName: decider[0]?.name ?? null,
		entries,
		outcomes: push.outcomes
			? workflowPushOutcomesSchema.parse(push.outcomes)
			: [],
	};
}

export interface WorkflowPushReviewEntry {
	id: string;
	name: string;
	change: WorkflowPushChange;
	enabled: boolean;
	stale: boolean;
	before: WorkflowDefinition | null;
	after: WorkflowDefinition;
	issues: LintResult[];
	blocking: string[];
}

export interface WorkflowPushReview extends WorkflowPushRecord {
	workflows: WorkflowPushReviewEntry[];
	blocked: boolean;
}

function reviewEntry(
	entry: WorkflowPushEntry,
	rows: readonly WorkflowRow[],
	catalog: readonly ValidationCatalogEntry[],
	definitions: readonly WorkflowDefinition[],
	open: boolean,
): WorkflowPushReviewEntry {
	const base =
		entry.baseWorkflowId === null
			? null
			: (rows.find((row) => row.id === entry.baseWorkflowId) ?? null);
	const merged = pushedDefinition(base?.definition ?? null, entry.definition);
	const enabled = base?.enabled ?? false;
	const report = reportWorkflows([merged], catalog)[0];
	const issues = issuesInState(report?.issues ?? [], enabled);
	const clash = nameClash(entry.definition, rows, definitions);
	return {
		id: entry.definition.id,
		name: entry.definition.name,
		change: entry.baseWorkflowId === null ? "new" : "changed",
		enabled,
		stale: open && drifted(entry, rows),
		before: entry.baseDefinition,
		after: redactWorkflowSecrets(
			pushedDefinition(entry.baseDefinition, entry.definition),
		),
		issues,
		blocking: [
			...(clash ? [clash] : []),
			...pushBlockingIssues(issues, enabled).map(validationIssueText),
		],
	};
}

export async function reviewWorkflowPush(
	db: Db,
	input: { orgId: string; repoId: string; pushId: string; now?: Date },
): Promise<WorkflowPushReview | null> {
	const push = await getWorkflowPush(db, input);
	if (!push || push.repoId !== input.repoId) {
		return null;
	}
	const [rows, catalog] = await Promise.all([
		listWorkflowRows(db, push.repoId),
		repoRuleCatalog(db, push.repoId),
	]);
	const definitions = push.entries.map((entry) => entry.definition);
	const open = push.status === "pending" || push.status === "stale";
	const workflows = push.entries.map((entry) =>
		reviewEntry(entry, rows, catalog, definitions, open),
	);
	return {
		...push,
		workflows,
		blocked: workflows.some((entry) => entry.blocking.length > 0),
	};
}

export type DecideWorkflowPushResult =
	| { ok: true; status: "accepted"; outcomes: WorkflowPushOutcome[] }
	| { ok: true; status: "rejected" }
	| { ok: false; reason: "not-found" }
	| {
			ok: false;
			reason: "already-decided";
			status: Exclude<WorkflowPushStatus, "pending">;
	  }
	| { ok: false; reason: "expired" }
	| { ok: false; reason: "stale"; workflows: string[] }
	| { ok: false; reason: "blocked"; blocks: PushBlock[] };

async function lockRepoRows(tx: Tx, repoId: string) {
	const rows = await tx
		.select()
		.from(workflowDefinitions)
		.where(eq(workflowDefinitions.repoId, repoId))
		.for("update");
	return rows.flatMap((row) => {
		const parsed = workflowDefinitionSchema.safeParse(row.definition);
		return parsed.success ? [{ ...row, definition: parsed.data }] : [];
	});
}

type LockedRow = Awaited<ReturnType<typeof lockRepoRows>>[number];

function acceptBlocks(
	entries: readonly WorkflowPushEntry[],
	rows: readonly LockedRow[],
	catalog: readonly ValidationCatalogEntry[],
): PushBlock[] {
	const definitions = entries.map((entry) => entry.definition);
	return entries.flatMap((entry) => {
		const base = rows.find((row) => row.id === entry.baseWorkflowId) ?? null;
		const merged = pushedDefinition(base?.definition ?? null, entry.definition);
		const enabled = base?.enabled ?? false;
		const report = reportWorkflows([merged], catalog)[0];
		const clash = nameClash(entry.definition, rows, definitions);
		const live: ValidationIssue[] = enabled
			? liveSaveRefusals(merged, catalog)
			: [];
		const issues = [
			...(clash ? [clash] : []),
			...pushBlockingIssues(report?.issues ?? [], enabled).map(
				validationIssueText,
			),
			...live.map(validationIssueText),
		];
		return issues.length > 0
			? [{ id: entry.definition.id, name: entry.definition.name, issues }]
			: [];
	});
}

async function applyEntry(
	tx: Tx,
	repoId: string,
	entry: WorkflowPushEntry,
	rows: readonly LockedRow[],
	now: Date,
): Promise<WorkflowPushOutcome> {
	const base = rows.find((row) => row.id === entry.baseWorkflowId);
	if (!base) {
		const definition = workflowDefinitionSchema.parse(
			pushedDefinition(null, entry.definition),
		);
		const workflowId = generateId();
		await tx.insert(workflowDefinitions).values({
			id: workflowId,
			repoId,
			name: definition.name,
			enabled: false,
			definition,
			createdAt: now,
			updatedAt: now,
		});
		return {
			id: definition.id,
			name: definition.name,
			outcome: "created",
			workflowId,
		};
	}
	const merged = workflowDefinitionSchema.parse(
		pushedDefinition(base.definition, entry.definition),
	);
	await tx
		.update(workflowDefinitions)
		.set({ definition: merged, name: merged.name, updatedAt: now })
		.where(eq(workflowDefinitions.id, base.id));
	await restartSchedules(tx, base.id, base.definition, merged);
	return {
		id: merged.id,
		name: merged.name,
		outcome: "updated",
		workflowId: base.id,
	};
}

export async function decideWorkflowPush(
	db: Db,
	input: {
		orgId: string;
		pushId: string;
		userId: string;
		decision: WorkflowPushDecision;
		now?: Date;
	},
): Promise<DecideWorkflowPushResult> {
	const now = input.now ?? new Date();
	const head = await db
		.select({ repoId: workflowPushProposals.repoId })
		.from(workflowPushProposals)
		.where(
			and(
				eq(workflowPushProposals.id, input.pushId),
				eq(workflowPushProposals.orgId, input.orgId),
			),
		)
		.limit(1);
	const repoId = head[0]?.repoId;
	if (!repoId) {
		return { ok: false, reason: "not-found" };
	}
	const catalog = await repoRuleCatalog(db, repoId);
	return await db.transaction(async (tx): Promise<DecideWorkflowPushResult> => {
		const locked = await tx
			.select()
			.from(workflowPushProposals)
			.where(eq(workflowPushProposals.id, input.pushId))
			.limit(1)
			.for("update");
		const push = locked[0];
		if (!push) {
			return { ok: false, reason: "not-found" };
		}
		if (push.status !== "pending") {
			return { ok: false, reason: "already-decided", status: push.status };
		}
		const close = (
			status: WorkflowPushStatus,
			outcomes: WorkflowPushOutcome[] | null = null,
		) =>
			tx
				.update(workflowPushProposals)
				.set({
					status,
					decidedAt: now,
					decidedBy:
						status === "accepted" || status === "rejected"
							? input.userId
							: null,
					outcomes,
				})
				.where(eq(workflowPushProposals.id, push.id));
		if (now.getTime() >= push.expiresAt.getTime()) {
			await close("expired");
			return { ok: false, reason: "expired" };
		}
		if (input.decision === "reject") {
			await close("rejected");
			return { ok: true, status: "rejected" };
		}
		const entries = workflowPushEntriesSchema.parse(push.entries);
		const rows = await lockRepoRows(tx, push.repoId);
		const moved = entries.filter((entry) => drifted(entry, rows));
		if (moved.length > 0) {
			await close("stale");
			return {
				ok: false,
				reason: "stale",
				workflows: moved.map((entry) => entry.definition.name),
			};
		}
		const blocks = acceptBlocks(entries, rows, catalog);
		if (blocks.length > 0) {
			return { ok: false, reason: "blocked", blocks };
		}
		const outcomes: WorkflowPushOutcome[] = [];
		for (const entry of entries) {
			outcomes.push(await applyEntry(tx, push.repoId, entry, rows, now));
		}
		await close("accepted", workflowPushOutcomesSchema.parse(outcomes));
		return { ok: true, status: "accepted", outcomes };
	});
}
