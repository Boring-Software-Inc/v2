import {
	bearsVerdict,
	GITCAFE_VERDICT_ACTION_KINDS,
	type GitCafeActionBinding,
	type GitCafeActionOperation,
	gitCafeActionBindingSchema,
	gitCafeActionOperationSchema,
	gitCafeActionPayloadSchema,
	gitCafeCheckRerequestedEventSchema,
	normalizedEventSchema,
	rerunChangeRequestJobSchema,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { pendingCheckIsStale, supersededBy } from "@tripwire/utils";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { organizationInstallations } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runActions, runs } from "../schema/runs.ts";
import type { DbLike } from "./access.ts";
import { getGitCafeActionAuthority } from "./gitcafe-lifecycle.ts";
import {
	createRun,
	getGitCafeEvaluationPhase,
	getLatestRunForChangeRequest,
} from "./runs.ts";

/** The request event's UUID also identifies its one re-run, so job replacement cannot create another evaluation. */
export async function prepareGitCafeCheckRerun(
	db: Db,
	input: {
		eventId: string;
		generation: number;
		mode: "existing" | "preview" | "create";
	},
) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		const [request] = await tx
			.select()
			.from(events)
			.where(and(eq(events.id, input.eventId), eq(events.forge, "gitcafe")));
		const parsed = gitCafeCheckRerequestedEventSchema.safeParse(request?.raw);
		if (
			!parsed.success ||
			request?.rawKind !== "check.rerequested" ||
			request.quarantined
		)
			return null;
		const event = parsed.data;
		if (
			!event.actor ||
			!event.checkRun.externalId ||
			event.checkRun.key !== "tripwire" ||
			event.checkRun.name !== "tripwire"
		)
			return null;
		const [reference] = await tx
			.select({ action: runActions, run: runs, event: events })
			.from(runActions)
			.innerJoin(runs, eq(runs.id, runActions.runId))
			.innerJoin(events, eq(events.id, runs.eventId))
			.where(
				and(
					eq(runActions.id, event.checkRun.externalId),
					eq(runActions.kind, "set-check"),
					eq(events.forge, "gitcafe"),
				),
			);
		if (!reference) return null;
		const normalized = normalizedEventSchema.safeParse(
			reference.event.normalized,
		);
		const payload = gitCafeActionPayloadSchema.safeParse(
			reference.action.payload,
		);
		if (
			!normalized.success ||
			!("changeRequest" in normalized.data) ||
			!payload.success ||
			normalized.data.forge !== "gitcafe" ||
			normalized.data.repoExternalId !== event.repository.id ||
			normalized.data.installationExternalId !== event.installation.id ||
			normalized.data.repo.fullName !==
				`${event.repository.owner}/${event.repository.name}` ||
			reference.run.repoFullName !== normalized.data.repo.fullName ||
			reference.run.subjectNumber !== normalized.data.changeRequest.number ||
			payload.data.sha !== event.checkRun.headOid ||
			reference.run.headSha !== event.checkRun.headOid
		)
			return null;
		const [repo] = await tx
			.select({ id: repos.id })
			.from(repos)
			.innerJoin(
				organizationInstallations,
				and(
					eq(organizationInstallations.forge, repos.forge),
					eq(organizationInstallations.installationId, repos.installationId),
					eq(organizationInstallations.organizationId, repos.orgId),
				),
			)
			.where(
				and(
					eq(repos.forge, "gitcafe"),
					eq(repos.externalId, event.repository.id),
					eq(repos.installationId, event.installation.id),
					eq(repos.fullName, normalized.data.repo.fullName),
					eq(repos.armed, true),
					isNull(repos.removedAt),
				),
			);
		if (
			!repo ||
			!(
				await getGitCafeActionAuthority(
					tx,
					event.installation.id,
					input.generation,
				)
			).allowed
		)
			return null;
		const [existing] = await tx
			.select()
			.from(runs)
			.where(eq(runs.id, input.eventId));
		const requestedBy = `gitcafe:${event.actor.id}`;
		if (
			existing &&
			(existing.repoFullName !== reference.run.repoFullName ||
				existing.subjectNumber !== reference.run.subjectNumber ||
				existing.triggeredBy !== requestedBy)
		)
			return null;
		if (existing) {
			const [source] = await tx
				.select()
				.from(events)
				.where(
					and(eq(events.id, existing.eventId), eq(events.forge, "gitcafe")),
				);
			const normalizedSource = normalizedEventSchema.safeParse(
				source?.normalized,
			);
			if (
				!normalizedSource.success ||
				!("changeRequest" in normalizedSource.data) ||
				normalizedSource.data.repoExternalId !== event.repository.id ||
				normalizedSource.data.installationExternalId !==
					event.installation.id ||
				normalizedSource.data.changeRequest.number !==
					reference.run.subjectNumber
			)
				return null;
		}
		if (!existing) {
			if (input.mode === "existing") return null;
			const snapshot = workflowDefinitionSchema
				.array()
				.min(1)
				.safeParse(reference.run.workflowSnapshot);
			if (!snapshot.success) return null;
			if (input.mode === "create")
				await createRun(tx, {
					id: input.eventId,
					eventId: reference.event.id,
					repoFullName: reference.run.repoFullName,
					subjectNumber: reference.run.subjectNumber,
					subjectKind: "change-request",
					headSha: event.checkRun.headOid,
					snapshot: snapshot.data,
					status: "queued",
					verdict: null,
					triggeredBy: requestedBy,
				});
		}
		return rerunChangeRequestJobSchema.parse({
			forge: "gitcafe",
			repoFullName: reference.run.repoFullName,
			number: reference.run.subjectNumber,
			requestedBy,
			runId: input.eventId,
			expectedHeadSha: event.checkRun.headOid,
		});
	});
}

export async function getPendingGitCafeReviewCleanup(db: Db, runId: string) {
	const rows = await db
		.select({
			id: runActions.id,
			kind: runActions.kind,
			payload: runActions.payload,
		})
		.from(runActions)
		.innerJoin(runs, eq(runs.id, runActions.runId))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(events.forge, "gitcafe"),
				eq(runActions.runId, runId),
				eq(runActions.kind, "dismiss-review"),
				eq(runActions.status, "recorded"),
			),
		)
		.orderBy(runActions.recordedAt, runActions.id);
	return rows.map((row) => ({
		...row,
		payload: gitCafeActionPayloadSchema.parse(row.payload),
	}));
}

export async function dispatchGitCafeReview(
	db: Db,
	actionId: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		if (!(await getGitCafeActionBinding(tx, actionId))) return false;
		const [row] = await tx
			.select({ payload: runActions.payload })
			.from(runActions)
			.where(eq(runActions.id, actionId))
			.for("update");
		const operation = gitCafeActionPayloadSchema.parse(
			row?.payload,
		).gitCafeOperation;
		if (!operation || operation.command.kind !== "review") return false;
		const dispatched = gitCafeActionOperationSchema.parse({
			...operation,
			dispatched: true,
		});
		await tx
			.update(runActions)
			.set({
				payload: sql`${runActions.payload} || jsonb_build_object('gitCafeOperation', ${JSON.stringify(dispatched)}::jsonb)`,
			})
			.where(eq(runActions.id, actionId));
		return true;
	});
}

/** Only a definitive first-attempt refusal proves that no remote submission needs reconciliation. */
export async function releaseGitCafeReview(
	db: Db,
	actionId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ payload: runActions.payload })
			.from(runActions)
			.where(eq(runActions.id, actionId))
			.for("update");
		const operation = gitCafeActionPayloadSchema.parse(
			row?.payload,
		).gitCafeOperation;
		if (
			!operation ||
			operation.command.kind !== "review" ||
			operation.reviewReceipt !== null
		)
			return;
		const released = gitCafeActionOperationSchema.parse({
			...operation,
			dispatched: false,
		});
		await tx
			.update(runActions)
			.set({
				payload: sql`${runActions.payload} || jsonb_build_object('gitCafeOperation', ${JSON.stringify(released)}::jsonb)`,
			})
			.where(eq(runActions.id, actionId));
	});
}

/** Receipt persistence records an observed effect even if its originating run has become obsolete. */
export async function recordGitCafeReviewReceipt(
	db: Db,
	actionId: string,
	reviewId: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ payload: runActions.payload })
			.from(runActions)
			.where(eq(runActions.id, actionId))
			.for("update");
		const operation = gitCafeActionPayloadSchema.parse(
			row?.payload,
		).gitCafeOperation;
		if (
			!operation ||
			operation.command.kind !== "review" ||
			!operation.dispatched ||
			(operation.reviewReceipt !== null && operation.reviewReceipt !== reviewId)
		)
			return false;
		const settled = gitCafeActionOperationSchema.parse({
			...operation,
			reviewReceipt: reviewId,
		});
		await tx
			.update(runActions)
			.set({
				payload: sql`${runActions.payload} || jsonb_build_object('gitCafeOperation', ${JSON.stringify(settled)}::jsonb)`,
			})
			.where(eq(runActions.id, actionId));
		return true;
	});
}

export async function getPendingGitCafeReviewSubmissions(
	db: Db,
	cleanupActionId: string,
): Promise<GitCafeActionOperation[] | null> {
	const binding = await getGitCafeActionBinding(db, cleanupActionId);
	const current = await getGitCafeRecordedAction(db, cleanupActionId);
	if (!binding || current?.kind !== "dismiss-review") return null;
	const rows = await db
		.select({ payload: runActions.payload })
		.from(runActions)
		.innerJoin(runs, eq(runs.id, runActions.runId))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(events.forge, "gitcafe"),
				eq(runs.repoFullName, binding.repoFullName),
				eq(runs.subjectNumber, binding.number),
				eq(runActions.kind, "block"),
			),
		);
	const operations: GitCafeActionOperation[] = [];
	for (const row of rows) {
		const parsed = gitCafeActionPayloadSchema.safeParse(row.payload);
		if (!parsed.success) return null;
		const operation = parsed.data.gitCafeOperation;
		if (
			operation?.command.kind === "review" &&
			operation.dispatched &&
			operation.reviewReceipt === null &&
			operation.installationId === binding.installationId &&
			operation.repositoryId === binding.repositoryId &&
			operation.number === binding.number
		)
			operations.push(operation);
	}
	return operations;
}

export async function getGitCafeRecordedAction(db: DbLike, actionId: string) {
	const [row] = await db
		.select({ kind: runActions.kind, payload: runActions.payload })
		.from(runActions)
		.where(and(eq(runActions.id, actionId), eq(runActions.status, "recorded")));
	if (!row) return null;
	return { ...row, payload: gitCafeActionPayloadSchema.parse(row.payload) };
}

export async function readGitCafeAction(
	db: DbLike,
	actionId: string,
): Promise<GitCafeActionOperation | null> {
	if (!(await getGitCafeActionBinding(db, actionId))) return null;
	const [action] = await db
		.select({ payload: runActions.payload })
		.from(runActions)
		.where(eq(runActions.id, actionId));
	const parsed = gitCafeActionPayloadSchema.safeParse(action?.payload);
	return parsed.success ? (parsed.data.gitCafeOperation ?? null) : null;
}

export async function getGitCafePendingCheckBinding(
	db: DbLike,
	eventId: string,
): Promise<GitCafeActionBinding | null> {
	const [row] = await db
		.select()
		.from(events)
		.where(and(eq(events.id, eventId), eq(events.forge, "gitcafe")));
	if (!row || row.quarantined) return null;
	const normalized = normalizedEventSchema.safeParse(row.normalized);
	if (
		!normalized.success ||
		normalized.data.forge !== "gitcafe" ||
		!("changeRequest" in normalized.data)
	)
		return null;
	const event = normalized.data;
	const latest = await getLatestRunForChangeRequest(
		db,
		{ forge: "gitcafe", fullName: event.repo.fullName },
		event.changeRequest.number,
	);
	if (pendingCheckIsStale(latest, eventId, event.changeRequest.headSha))
		return null;
	if (!event.repoExternalId || !event.installationExternalId) return null;
	const [repo] = await db
		.select()
		.from(repos)
		.innerJoin(
			organizationInstallations,
			and(
				eq(organizationInstallations.forge, repos.forge),
				eq(organizationInstallations.installationId, repos.installationId),
				eq(organizationInstallations.organizationId, repos.orgId),
			),
		)
		.where(
			and(
				eq(repos.forge, "gitcafe"),
				eq(repos.fullName, event.repo.fullName),
				eq(repos.externalId, event.repoExternalId),
				eq(repos.installationId, event.installationExternalId),
				eq(repos.armed, true),
				isNull(repos.removedAt),
			),
		);
	if (
		!repo ||
		!(await getGitCafeActionAuthority(db, event.installationExternalId)).allowed
	)
		return null;
	return gitCafeActionBindingSchema.parse({
		actionId: eventId,
		installationId: event.installationExternalId,
		repositoryId: event.repoExternalId,
		repoFullName: event.repo.fullName,
		subject: "change-request",
		number: event.changeRequest.number,
		headOid: event.changeRequest.headSha,
		recordedAt: row.receivedAt.toISOString(),
	});
}

export async function getGitCafeActionBinding(
	db: DbLike,
	actionId: string,
): Promise<GitCafeActionBinding | null> {
	const [row] = await db
		.select({
			action: runActions,
			run: runs,
			event: events,
		})
		.from(runActions)
		.innerJoin(runs, eq(runs.id, runActions.runId))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runActions.id, actionId),
				eq(events.forge, "gitcafe"),
				eq(runActions.status, "recorded"),
			),
		);
	if (!row || row.run.backfill) return null;
	if (GITCAFE_VERDICT_ACTION_KINDS.has(row.action.kind)) {
		const payload = gitCafeActionPayloadSchema.safeParse(row.action.payload);
		const phase = await getGitCafeEvaluationPhase(db, row.run.id);
		if (
			!payload.success ||
			!phase ||
			JSON.stringify(payload.data.gitCafePhase) !== JSON.stringify(phase)
		)
			return null;
	}
	const normalized = normalizedEventSchema.safeParse(row.event.normalized);
	if (
		!normalized.success ||
		normalized.data.forge !== "gitcafe" ||
		!("repo" in normalized.data)
	)
		return null;
	const event = normalized.data;
	if ("changeRequest" in event && bearsVerdict(event.kind)) {
		const latest = await getLatestRunForChangeRequest(
			db,
			{ forge: "gitcafe", fullName: row.run.repoFullName },
			event.changeRequest.number,
		);
		if (
			supersededBy(
				row.action.kind,
				{ id: row.run.id, headSha: row.run.headSha },
				latest,
			)
		)
			return null;
	}
	if (
		!event.repoExternalId ||
		!event.installationExternalId ||
		row.run.subjectNumber === null
	)
		return null;
	const [repo] = await db
		.select()
		.from(repos)
		.innerJoin(
			organizationInstallations,
			and(
				eq(organizationInstallations.forge, repos.forge),
				eq(organizationInstallations.installationId, repos.installationId),
				eq(organizationInstallations.organizationId, repos.orgId),
			),
		)
		.where(
			and(
				eq(repos.forge, "gitcafe"),
				eq(repos.externalId, event.repoExternalId),
				eq(repos.installationId, event.installationExternalId),
				eq(repos.fullName, row.run.repoFullName),
				isNull(repos.removedAt),
			),
		);
	if (
		!repo ||
		(!repo.repos.armed &&
			!["dismiss-review", "delete-comment"].includes(row.action.kind))
	)
		return null;
	const authority = await getGitCafeActionAuthority(
		db,
		event.installationExternalId,
	);
	if (!authority.allowed) return null;
	const subject =
		"comment" in event
			? (event.comment.subjectKind ?? "change-request")
			: "thread" in event
				? event.thread.kind
				: "change-request";
	return gitCafeActionBindingSchema.parse({
		actionId,
		installationId: event.installationExternalId,
		repositoryId: event.repoExternalId,
		repoFullName: row.run.repoFullName,
		subject,
		number: row.run.subjectNumber,
		headOid: row.run.headSha,
		recordedAt: row.action.recordedAt.toISOString(),
	});
}

/** A create command is immutable once stored; retries reuse the original review request ID, version and body. */
export async function prepareGitCafeAction(
	db: Db,
	input: GitCafeActionOperation,
): Promise<GitCafeActionOperation | null> {
	const operation = gitCafeActionOperationSchema.parse(input);
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		const binding = await getGitCafeActionBinding(tx, operation.actionId);
		if (!binding || bindingKey(binding) !== bindingKey(operation)) return null;
		const [row] = await tx
			.select()
			.from(runActions)
			.where(eq(runActions.id, operation.actionId))
			.for("update");
		if (!row || row.status !== "recorded") return null;
		if (
			operation.command.kind === "review"
				? row.kind !== "block"
				: !["comment", "post-comment"].includes(row.kind)
		)
			return null;
		const payload = gitCafeActionPayloadSchema.parse(row.payload);
		if (payload.gitCafeOperation) {
			const prior = payload.gitCafeOperation;
			if (bindingKey(prior) !== bindingKey(operation)) return null;
			return prior;
		}
		await tx
			.update(runActions)
			.set({
				payload: sql`${runActions.payload} || jsonb_build_object('gitCafeOperation', ${JSON.stringify(operation)}::jsonb)`,
			})
			.where(eq(runActions.id, operation.actionId));
		return operation;
	});
}

/** Persist the one allowed dispatch before I/O; a crash thereafter requires marker reconciliation. */
export async function claimGitCafeComment(
	db: Db,
	actionId: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		if (!(await getGitCafeActionBinding(tx, actionId))) return false;
		const [row] = await tx
			.select()
			.from(runActions)
			.where(eq(runActions.id, actionId))
			.for("update");
		if (!row || row.status !== "recorded") return false;
		const operation = gitCafeActionPayloadSchema.parse(
			row.payload,
		).gitCafeOperation;
		if (!operation) return false;
		if (
			operation.actionId !== actionId ||
			operation.command.kind !== "comment" ||
			operation.dispatched
		)
			return false;
		const dispatched = gitCafeActionOperationSchema.parse({
			...operation,
			dispatched: true,
		});
		await tx
			.update(runActions)
			.set({
				payload: sql`${runActions.payload} || jsonb_build_object('gitCafeOperation', ${JSON.stringify(dispatched)}::jsonb)`,
			})
			.where(eq(runActions.id, actionId));
		return true;
	});
}

function bindingKey(binding: GitCafeActionBinding): string {
	return JSON.stringify([
		binding.actionId,
		binding.installationId,
		binding.repositoryId,
		binding.repoFullName,
		binding.subject,
		binding.number,
		binding.headOid,
		binding.recordedAt,
	]);
}

/** A definitive provider refusal permits retry; uncertain writes retain their dispatch fence. */
export async function releaseGitCafeComment(
	db: Db,
	actionId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		if (!(await getGitCafeActionBinding(tx, actionId))) return;
		const [row] = await tx
			.select({ payload: runActions.payload })
			.from(runActions)
			.where(eq(runActions.id, actionId))
			.for("update");
		const operation = gitCafeActionPayloadSchema.parse(
			row?.payload,
		).gitCafeOperation;
		if (
			!operation ||
			operation.command.kind !== "comment" ||
			operation.actionId !== actionId
		)
			return;
		const released = gitCafeActionOperationSchema.parse({
			...operation,
			dispatched: false,
		});
		await tx
			.update(runActions)
			.set({
				payload: sql`${runActions.payload} || jsonb_build_object('gitCafeOperation', ${JSON.stringify(released)}::jsonb)`,
			})
			.where(eq(runActions.id, actionId));
	});
}
