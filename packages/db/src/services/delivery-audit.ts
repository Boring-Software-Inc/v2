import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { organizationInstallations } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { githubDeliveryAudit, opsCursors } from "../schema/workers.ts";

export const DELIVERY_AUDIT_CURSOR = "github-delivery-audit";

export type DeliveryProblemStatus =
	(typeof githubDeliveryAudit.$inferSelect)["status"];

export interface DeliveryRepoTarget {
	armed: boolean;
	claimed: boolean;
	removed: boolean;
	pushTriggered: boolean;
	/** The last change to the repo's routing settings or its workflows. */
	changedAt: Date;
}

export async function readCursor(db: Db, key: string): Promise<Date | null> {
	const rows = await db
		.select({ position: opsCursors.position })
		.from(opsCursors)
		.where(eq(opsCursors.key, key));
	return rows[0]?.position ?? null;
}

export async function advanceCursor(
	db: Db,
	key: string,
	position: Date,
): Promise<void> {
	await db
		.insert(opsCursors)
		.values({ key, position })
		.onConflictDoUpdate({
			target: opsCursors.key,
			set: { position, updatedAt: sql`now()` },
		});
}

/** Which of these GitHub delivery guids ingest stored as events. */
export async function storedDeliveryGuids(
	db: Db,
	guids: readonly string[],
): Promise<Set<string>> {
	if (guids.length === 0) return new Set();
	const rows = await db
		.select({ deliveryId: events.deliveryId })
		.from(events)
		.where(
			and(eq(events.forge, "github"), inArray(events.deliveryId, [...guids])),
		);
	return new Set(rows.map((row) => row.deliveryId));
}

/**
 * Tripwire's state for the repos and installations deliveries name, keyed by
 * GitHub's ids. Repos are matched by id, not name, so a renamed repo still
 * counts as armed. Claimed installations map to when the org claimed them.
 */
export async function deliveryTargets(
	db: Db,
	input: {
		repositoryIds: readonly string[];
		installationIds: readonly string[];
	},
): Promise<{
	repos: Map<string, DeliveryRepoTarget>;
	claimedInstallations: Map<string, Date>;
}> {
	const repoRows =
		input.repositoryIds.length === 0
			? []
			: await db
					.select({
						externalId: repos.externalId,
						armed: repos.armed,
						claimed: sql<boolean>`${repos.orgId} IS NOT NULL`,
						removed: sql<boolean>`${repos.removedAt} IS NOT NULL`,
						// "repos"."id" spelled out: drizzle renders ${repos.id} as a bare
						// "id" here, which the subquery reads as w.id.
						pushTriggered: sql<boolean>`EXISTS (
							SELECT 1 FROM workflow_definitions w
							WHERE w.repo_id = "repos"."id" AND w.enabled
								AND jsonb_path_exists(w.definition,
									'$.nodes[*] ? (@.type == "trigger" && @.kinds[*] == "push")'))`,
						changedAt: sql<Date>`GREATEST("repos"."routing_changed_at",
							(SELECT max(w.updated_at) FROM workflow_definitions w
								WHERE w.repo_id = "repos"."id"))`.mapWith(
							repos.routingChangedAt,
						),
					})
					.from(repos)
					.where(
						and(
							eq(repos.forge, "github"),
							inArray(repos.externalId, [...input.repositoryIds]),
						),
					);
	const installationRows =
		input.installationIds.length === 0
			? []
			: await db
					.select({
						installationId: organizationInstallations.installationId,
						createdAt: organizationInstallations.createdAt,
					})
					.from(organizationInstallations)
					.where(
						and(
							eq(organizationInstallations.forge, "github"),
							inArray(organizationInstallations.installationId, [
								...input.installationIds,
							]),
						),
					);
	return {
		repos: new Map(
			repoRows.map(({ externalId, ...target }) => [externalId, target]),
		),
		claimedInstallations: new Map(
			installationRows.map((row) => [row.installationId, row.createdAt]),
		),
	};
}

export async function deliveryProblems(
	db: Db,
	guids: readonly string[],
): Promise<Map<string, { status: DeliveryProblemStatus; updatedAt: Date }>> {
	if (guids.length === 0) return new Map();
	const rows = await db
		.select({
			guid: githubDeliveryAudit.guid,
			status: githubDeliveryAudit.status,
			updatedAt: githubDeliveryAudit.updatedAt,
		})
		.from(githubDeliveryAudit)
		.where(inArray(githubDeliveryAudit.guid, [...guids]));
	return new Map(rows.map(({ guid, ...problem }) => [guid, problem]));
}

export interface DeliveryProblemInput {
	guid: string;
	attemptId: string;
	event: string;
	action: string | null;
	installationId: string | null;
	repositoryId: string | null;
	deliveredAt: Date;
	statusCode: number | null;
	status: DeliveryProblemStatus;
}

export async function recordDeliveryProblem(
	db: Db,
	input: DeliveryProblemInput,
): Promise<void> {
	const attemptId = BigInt(input.attemptId);
	await db
		.insert(githubDeliveryAudit)
		.values({ ...input, attemptId })
		.onConflictDoUpdate({
			target: githubDeliveryAudit.guid,
			set: {
				attemptId,
				status: input.status,
				statusCode: input.statusCode,
				updatedAt: sql`now()`,
			},
		});
}

/** Redeliveries the audit asked for that are still unresolved. */
export async function redeliveriesUpdatedBefore(
	db: Db,
	before: Date,
): Promise<{ guid: string; event: string }[]> {
	return await db
		.select({
			guid: githubDeliveryAudit.guid,
			event: githubDeliveryAudit.event,
		})
		.from(githubDeliveryAudit)
		.where(
			and(
				eq(githubDeliveryAudit.status, "redelivered"),
				lt(githubDeliveryAudit.updatedAt, before),
			),
		);
}

export async function setDeliveryProblemStatus(
	db: Db,
	guid: string,
	status: DeliveryProblemStatus,
): Promise<void> {
	await db
		.update(githubDeliveryAudit)
		.set({ status, updatedAt: sql`now()` })
		.where(eq(githubDeliveryAudit.guid, guid));
}

/** Audit rows older than GitHub's three-day delivery log are no longer useful. */
export async function pruneDeliveryAudit(
	db: Db,
	olderThanDays = 14,
): Promise<void> {
	await db.execute(sql`
		DELETE FROM github_delivery_audit
		WHERE updated_at < now() - make_interval(days => ${olderThanDays})
	`);
}

/** Everything the delivery audit reads and writes, bound to one database. */
export function deliveryAuditStore(db: Db) {
	return {
		readCursor: () => readCursor(db, DELIVERY_AUDIT_CURSOR),
		advanceCursor: (position: Date) =>
			advanceCursor(db, DELIVERY_AUDIT_CURSOR, position),
		storedDeliveryGuids: (guids: readonly string[]) =>
			storedDeliveryGuids(db, guids),
		deliveryTargets: (input: Parameters<typeof deliveryTargets>[1]) =>
			deliveryTargets(db, input),
		deliveryProblems: (guids: readonly string[]) => deliveryProblems(db, guids),
		recordDeliveryProblem: (input: DeliveryProblemInput) =>
			recordDeliveryProblem(db, input),
		redeliveriesUpdatedBefore: (before: Date) =>
			redeliveriesUpdatedBefore(db, before),
		setDeliveryProblemStatus: (guid: string, status: DeliveryProblemStatus) =>
			setDeliveryProblemStatus(db, guid, status),
		prune: () => pruneDeliveryAudit(db),
	};
}

export type DeliveryAuditStore = ReturnType<typeof deliveryAuditStore>;
