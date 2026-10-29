import {
	type GitCafeActionBinding,
	type GitCafeActionOperation,
	gitCafeActionBindingSchema,
	gitCafeActionOperationSchema,
	gitCafeActionPayloadSchema,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { organizationInstallations } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runActions, runs } from "../schema/runs.ts";
import type { DbLike } from "./access.ts";
import { getGitCafeActionAuthority } from "./gitcafe-lifecycle.ts";

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
	const normalized = normalizedEventSchema.safeParse(row.event.normalized);
	if (
		!normalized.success ||
		normalized.data.forge !== "gitcafe" ||
		!("repo" in normalized.data)
	)
		return null;
	const event = normalized.data;
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
