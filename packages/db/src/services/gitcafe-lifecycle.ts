import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_MAX_BYTES,
	type GitCafeLifecycleLookup,
	type GitCafeReceipt,
	type GitCafeReceiptStatus,
	type GitCafeRetirement,
	gitCafeInstallationCreatedSchema,
	gitCafeLifecycleEventSchema,
	gitCafeLifecycleEventTypeSchema,
	gitCafeLifecycleLookupSchema,
	gitCafeReceiptJobSchema,
	gitCafeReceiptSchema,
	gitCafeRepositoriesUpdatedSchema,
	gitCafeRetirementSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { PgBoss } from "pg-boss";
import type { Db } from "../client.ts";
import type { BossErrorLogger } from "../queue.ts";
import {
	gitCafeInstallationLifecycle,
	gitCafeReceipts,
} from "../schema/gitcafe-lifecycle.ts";
import { organizationInstallations } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import type { DbLike } from "./access.ts";

/** No general queues, schema migration, scheduler, or backlog maintenance in this process. */
export async function createGitCafeLifecycleBoss(
	databaseUrl: string,
	logger: BossErrorLogger,
): Promise<PgBoss> {
	const boss = new PgBoss({
		connectionString: databaseUrl,
		schedule: false,
		supervise: false,
		migrate: false,
		createSchema: false,
	});
	boss.on("error", () =>
		logger.error(
			{ error: "queue-unavailable" },
			"GitCafe lifecycle queue unavailable",
		),
	);
	try {
		await boss.start();
		await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
		return boss;
	} catch (error) {
		await boss.stop({ graceful: false }).catch(() => undefined);
		throw error;
	}
}

export async function insertGitCafeReceipt(
	pool: Pool,
	boss: PgBoss,
	input: GitCafeReceipt,
): Promise<{ inserted: boolean; receiptId: string }> {
	const receipt = gitCafeReceiptSchema.parse(input);
	if (!receiptBytesMatch(receipt))
		throw new Error("GitCafe receipt bytes do not match its envelope");
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		/** Linearize receipt admission with connection commits and lifecycle changes. */
		await client.query(
			"SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))",
		);
		const id = generateId();
		const result = await client.query<{ id: string }>(
			`INSERT INTO gitcafe_receipts (id, installation_id, event_id, delivery_id, event_type, receipt)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (installation_id, event_id) DO NOTHING RETURNING id`,
			[
				id,
				receipt.payload.installation.id,
				receipt.payload.id,
				receipt.deliveryId,
				receipt.payload.type,
				JSON.stringify(receipt),
			],
		);
		if (result.rowCount === 1) {
			const data = gitCafeReceiptJobSchema.parse({
				receiptId: id,
				requestId: receipt.requestId,
			});
			const queued = await boss.insert(
				GITCAFE_LIFECYCLE_QUEUE,
				[
					{
						id: generateId(),
						data,
						retryLimit: 5,
						retryDelay: 15,
						retryBackoff: true,
					},
				],
				{
					returnId: true,
					db: {
						executeSql: (text: string, values?: unknown[]) =>
							client.query(text, values),
					},
				},
			);
			if (queued?.length !== 1)
				throw new Error("GitCafe receipt enqueue did not insert one job");
			await client.query("COMMIT");
			return { inserted: true, receiptId: id };
		}
		const existing = await client.query<{ id: string }>(
			`SELECT id FROM gitcafe_receipts WHERE installation_id = $1 AND event_id = $2`,
			[receipt.payload.installation.id, receipt.payload.id],
		);
		const prior = existing.rows[0];
		if (!prior) throw new Error("GitCafe receipt conflict has no stored event");
		await client.query("COMMIT");
		return { inserted: false, receiptId: prior.id };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

function receiptBytesMatch(receipt: GitCafeReceipt): boolean {
	try {
		const bytes = Buffer.from(receipt.bodyBase64, "base64");
		return (
			bytes.length <= GITCAFE_RECEIPT_MAX_BYTES &&
			createHash("sha256").update(bytes).digest("hex") === receipt.bodySha256 &&
			isDeepStrictEqual(
				JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
				receipt.payload,
			)
		);
	} catch {
		return false;
	}
}

/** Share the connection writer's lock so retirement cannot race a claim or refresh. */
async function lockLifecycle(tx: DbLike, installationId: string) {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
	);
	await tx
		.insert(gitCafeInstallationLifecycle)
		.values({ installationId, status: "reconcile-required" })
		.onConflictDoNothing();
	const [state] = await tx
		.select()
		.from(gitCafeInstallationLifecycle)
		.where(eq(gitCafeInstallationLifecycle.installationId, installationId))
		.for("update");
	if (!state) throw new Error("GitCafe lifecycle state missing after insert");
	return state;
}

async function removeRepositories(
	tx: DbLike,
	installationId: string,
	restriction?: ReturnType<typeof sql>,
) {
	const removed = await tx
		.update(repos)
		.set({
			removedAt: sql`coalesce(${repos.removedAt}, now())`,
			armed: false,
			backfillTotal: null,
			backfillDone: null,
		})
		.where(
			and(
				eq(repos.forge, "gitcafe"),
				eq(repos.installationId, installationId),
				restriction,
			),
		)
		.returning({ id: repos.id });
	return removed.length;
}

/** A lookup failure withdraws authority; it never proves an uninstall. */
export async function retireGitCafeInstallation(
	db: Db,
	input: GitCafeRetirement,
) {
	return db.transaction((tx) =>
		retireGitCafeInstallationInTransaction(tx, input),
	);
}

/** Reuse a connection transaction; opening another one here would deadlock on its advisory lock. */
export async function retireGitCafeInstallationInTransaction(
	tx: DbLike,
	input: GitCafeRetirement,
	organizationId?: string,
) {
	const retirement = gitCafeRetirementSchema.parse(input);
	const state = await lockLifecycle(tx, retirement.installationId);
	const removedCount = await removeRepositories(
		tx,
		retirement.installationId,
		organizationId === undefined
			? undefined
			: sql`${repos.orgId} = ${organizationId}`,
	);
	const status =
		state.status === "uninstalled" ? "uninstalled" : retirement.reason;
	await tx
		.update(gitCafeInstallationLifecycle)
		.set({ status, generation: state.generation + 1, updatedAt: new Date() })
		.where(
			eq(
				gitCafeInstallationLifecycle.installationId,
				retirement.installationId,
			),
		);
	return { status, generation: state.generation + 1, removedCount };
}

async function hasPendingRevocation(
	db: DbLike,
	installationId: string,
): Promise<boolean> {
	const [pending] = await db
		.select({ id: gitCafeReceipts.id })
		.from(gitCafeReceipts)
		.where(
			and(
				eq(gitCafeReceipts.installationId, installationId),
				eq(gitCafeReceipts.status, "pending"),
				inArray(gitCafeReceipts.eventType, [
					"installation.repositories_updated",
					"installation.paused",
					"installation.uninstalled",
				]),
			),
		)
		.limit(1);
	return pending !== undefined;
}

/** Call before minting credentials and again immediately before using them. Missing authority fails closed. */
export async function getGitCafeActionAuthority(
	db: DbLike,
	installationId: string,
	generation?: number,
) {
	const pending = db
		.select({ id: gitCafeReceipts.id })
		.from(gitCafeReceipts)
		.where(
			and(
				eq(gitCafeReceipts.installationId, installationId),
				eq(gitCafeReceipts.status, "pending"),
				inArray(gitCafeReceipts.eventType, [
					"installation.repositories_updated",
					"installation.paused",
					"installation.uninstalled",
				]),
			),
		);
	const [state] = await db
		.select()
		.from(gitCafeInstallationLifecycle)
		.where(
			and(
				eq(gitCafeInstallationLifecycle.installationId, installationId),
				notExists(pending),
			),
		);
	return state?.status === "active" &&
		state.authorityAt !== null &&
		(generation === undefined || state.generation === generation)
		? {
				allowed: true as const,
				generation: state.generation,
				providerVersion: state.providerVersion,
			}
		: { allowed: false as const };
}

/** Fresh app authority can reduce access, but only explicit person-authorized connection may restore visibility. */
export async function reconcileGitCafeInstallation(
	db: Db,
	input: {
		installationId: string;
		expectedAppId: string;
		expectedOwner?: string;
		organizationId?: string;
		lookup: () => Promise<GitCafeLifecycleLookup>;
	},
) {
	const installationId = gitCafeRetirementSchema.shape.installationId.parse(
		input.installationId,
	);
	const readRepositoryScope = async (tx: DbLike) => {
		if (input.organizationId !== undefined) {
			const [claim] = await tx
				.select()
				.from(organizationInstallations)
				.where(
					and(
						eq(organizationInstallations.forge, "gitcafe"),
						eq(organizationInstallations.installationId, installationId),
					),
				);
			if (
				claim &&
				(claim.organizationId !== input.organizationId ||
					(input.expectedOwner !== undefined &&
						claim.accountLogin !== input.expectedOwner))
			)
				return null;
			return claim ? sql`${repos.orgId} = ${input.organizationId}` : sql`false`;
		}
		return sql`true`;
	};
	const before = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		if ((await readRepositoryScope(tx)) === null) return null;
		return lockLifecycle(tx, installationId);
	});
	if (before === null)
		return { ok: false as const, reason: "identity-mismatch" as const };
	const startedAt = new Date();
	let lookup: GitCafeLifecycleLookup;
	try {
		const parsed = gitCafeLifecycleLookupSchema.safeParse(await input.lookup());
		lookup = parsed.success
			? parsed.data
			: { ok: false, reason: "invalid-response" };
	} catch {
		lookup = { ok: false, reason: "lookup-unavailable" };
	}
	return db.transaction(async (tx) => {
		const state = await lockLifecycle(tx, installationId);
		const repositoryScope = await readRepositoryScope(tx);
		if (repositoryScope === null)
			return { ok: false as const, reason: "identity-mismatch" as const };
		if (
			state.generation !== before.generation ||
			(await hasPendingRevocation(tx, installationId))
		)
			return { ok: false as const, reason: "stale" as const };
		let authority = lookup.ok ? lookup.value : null;
		let refusal: "identity-mismatch" | "stale" | undefined;
		if (
			authority &&
			(authority.id !== installationId ||
				authority.appId !== input.expectedAppId ||
				(input.expectedOwner !== undefined &&
					authority.org !== input.expectedOwner))
		)
			refusal = "identity-mismatch";
		if (
			authority &&
			((state.providerVersion !== null &&
				authority.version < state.providerVersion) ||
				(state.providerRevision !== null &&
					authority.revision < state.providerRevision))
		)
			refusal = "stale";
		if (refusal) authority = null;
		const status =
			state.status === "uninstalled" || authority?.uninstalledAt != null
				? "uninstalled"
				: !authority
					? "reconcile-required"
					: authority.pausedAt !== null || authority.suspendedAt !== null
						? "paused"
						: "active";
		const restriction =
			status === "active" && authority
				? authority.repositorySelection === "selected"
					? sql`(${repos.owner} <> ${authority.org} OR NOT (${repos.name} = ANY(${sql.param(authority.repositories)}::text[])))`
					: sql`${repos.owner} <> ${authority.org}`
				: undefined;
		const removedCount = await removeRepositories(
			tx,
			installationId,
			sql`${repositoryScope} AND ${restriction ?? sql`true`}`,
		);
		await tx
			.update(gitCafeInstallationLifecycle)
			.set({
				status,
				generation: state.generation + 1,
				updatedAt: new Date(),
				authorityAt: authority ? startedAt : state.authorityAt,
				providerVersion: authority?.version ?? state.providerVersion,
				providerRevision: authority?.revision ?? state.providerRevision,
			})
			.where(eq(gitCafeInstallationLifecycle.installationId, installationId));
		if (refusal) return { ok: false as const, reason: refusal };
		return {
			ok: true as const,
			status,
			generation: state.generation + 1,
			removedCount,
		};
	});
}

export async function processGitCafeReceipt(
	db: Db,
	receiptId: string,
): Promise<GitCafeReceiptStatus> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		const [row] = await tx
			.select()
			.from(gitCafeReceipts)
			.where(eq(gitCafeReceipts.id, receiptId))
			.for("update");
		if (!row) throw new Error("GitCafe receipt not found");
		if (row.status !== "pending") return row.status;
		const receipt = gitCafeReceiptSchema.safeParse(row.receipt);
		let status: GitCafeReceiptStatus = "malformed";
		if (
			receipt.success &&
			receiptBytesMatch(receipt.data) &&
			receipt.data.payload.installation.id === row.installationId &&
			receipt.data.payload.id === row.eventId &&
			receipt.data.payload.type === row.eventType
		) {
			const supported = gitCafeLifecycleEventTypeSchema.safeParse(
				row.eventType,
			);
			const event = gitCafeLifecycleEventSchema.safeParse(receipt.data.payload);
			if (!supported.success) status = "parked";
			else if (event.success) {
				const created =
					event.data.type === "installation.created"
						? gitCafeInstallationCreatedSchema.safeParse(event.data)
						: null;
				const updated =
					event.data.type === "installation.repositories_updated"
						? gitCafeRepositoriesUpdatedSchema.safeParse(event.data)
						: null;
				if (created?.success === false || updated?.success === false)
					status = "malformed";
				else {
					const state = await lockLifecycle(tx, row.installationId);
					const occurredAt = new Date(event.data.createdAt);
					if (
						event.data.type !== "installation.uninstalled" &&
						((event.data.type === "installation.created" &&
							state.lastEventAt &&
							occurredAt < state.lastEventAt) ||
							(state.authorityAt && occurredAt < state.authorityAt))
					)
						status = "stale";
					else if (state.status === "uninstalled") status = "stale";
					else {
						const nextStatus =
							event.data.type === "installation.uninstalled"
								? "uninstalled"
								: event.data.type === "installation.paused"
									? "paused"
									: state.status === "paused"
										? "paused"
										: "reconcile-required";
						if (event.data.type !== "installation.created") {
							const removal =
								updated?.success &&
								updated.data.repositorySelection === "selected" &&
								updated.data.previousRepositorySelection === "selected" &&
								updated.data.repositoriesRemovedTruncated === false &&
								updated.data.repositoriesRemoved !== undefined
									? sql`${repos.externalId} = ANY(${sql.param(updated.data.repositoriesRemoved.map((repo) => repo.id))}::text[])`
									: undefined;
							await removeRepositories(tx, row.installationId, removal);
						}
						await tx
							.update(gitCafeInstallationLifecycle)
							.set({
								status: nextStatus,
								generation: state.generation + 1,
								lastEventAt:
									state.lastEventAt && state.lastEventAt > occurredAt
										? state.lastEventAt
										: occurredAt,
								lastEventId:
									state.lastEventAt && state.lastEventAt > occurredAt
										? state.lastEventId
										: row.eventId,
								updatedAt: new Date(),
							})
							.where(
								eq(
									gitCafeInstallationLifecycle.installationId,
									row.installationId,
								),
							);
						status = "applied";
					}
				}
			}
		}
		await tx
			.update(gitCafeReceipts)
			.set({ status, processedAt: new Date() })
			.where(
				and(
					eq(gitCafeReceipts.id, receiptId),
					ne(gitCafeReceipts.status, status),
				),
			);
		return status;
	});
}
