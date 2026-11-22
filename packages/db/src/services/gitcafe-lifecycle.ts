import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RECEIPT_MAX_BYTES,
	GITCAFE_REFRESH_CATALOGS_QUEUE,
	type GitCafeCatalogValues,
	type GitCafeEventSettlement,
	type GitCafeLifecycleLookup,
	type GitCafeReceipt,
	type GitCafeReceiptStatus,
	type GitCafeRecoveryItem,
	type GitCafeRecoveryRequest,
	type GitCafeRecoverySelection,
	type GitCafeRepositoryBinding,
	type GitCafeRetirement,
	gitCafeCatalogValuesSchema,
	gitCafeCompletePushEventSchema,
	gitCafeDispatchableRepositoryEventTypeSchema,
	gitCafeEventSettlementSchema,
	gitCafeInstallationCreatedSchema,
	gitCafeLifecycleEventSchema,
	gitCafeLifecycleEventTypeSchema,
	gitCafeLifecycleLookupSchema,
	gitCafeProcessEventJobSchema,
	gitCafePushRefDeliverySchema,
	gitCafeReceiptJobSchema,
	gitCafeReceiptSchema,
	gitCafeRecoveryAuditSchema,
	gitCafeRecoveryItemSchema,
	gitCafeRecoveryRequestSchema,
	gitCafeRecoverySelectionSchema,
	gitCafeRefreshCatalogsJobSchema,
	gitCafeRepositoriesUpdatedSchema,
	gitCafeRepositoryBindingSchema,
	gitCafeRetirementSchema,
	type ScheduledEvent,
	scheduledEventSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { PgBoss } from "pg-boss";
import { type Db, requirePostgresPool } from "../client.ts";
import type { BossErrorLogger } from "../queue.ts";
import {
	gitCafeInstallationLifecycle,
	gitCafeReceipts,
} from "../schema/gitcafe-lifecycle.ts";
import { organizationInstallations } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import type { DbLike } from "./access.ts";
import { replaceRepoLabels } from "./labels.ts";
import { upsertRepoSuggestions } from "./repos.ts";
import { replaceGitCafeReviewerSuggestions } from "./reviewers.ts";

/** Scheduled events originate locally; admission and their dedicated job commit under current claimed authority. */
export async function insertGitCafeScheduledEvent(
	db: Db,
	boss: PgBoss,
	input: {
		event: ScheduledEvent;
		binding: GitCafeRepositoryBinding;
		requestId: string;
	},
): Promise<
	{ ok: true; inserted: boolean } | { ok: false; reason: "inactive" }
> {
	const event = scheduledEventSchema.parse(input.event);
	const binding = gitCafeRepositoryBindingSchema.parse(input.binding);
	const job = gitCafeProcessEventJobSchema.parse({
		eventId: generateId(),
		requestId: input.requestId,
	});
	if (
		event.forge !== "gitcafe" ||
		event.repoExternalId !== binding.repositoryId ||
		event.installationExternalId !== binding.installationId ||
		event.repo.fullName !== binding.fullName ||
		`${event.repo.owner}/${event.repo.name}` !== binding.fullName ||
		!event.thread.externalId
	)
		return { ok: false, reason: "inactive" };
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN");
		await client.query(
			"SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))",
		);
		const owned = await client.query(
			`SELECT r.id FROM repos r JOIN organization_installations i ON i.forge = r.forge AND i.installation_id = r.installation_id AND i.organization_id = r.org_id
			WHERE r.id = $1 AND r.forge = 'gitcafe' AND r.external_id = $2 AND r.full_name = $3 AND r.org_id = $4 AND r.installation_id = $5 AND r.removed_at IS NULL AND r.armed = true FOR UPDATE OF r, i`,
			[
				binding.repoId,
				binding.repositoryId,
				binding.fullName,
				binding.organizationId,
				binding.installationId,
			],
		);
		if (
			!owned.rowCount ||
			!(
				await getGitCafeActionAuthority(
					db,
					binding.installationId,
					binding.generation,
				)
			).allowed
		) {
			await client.query("ROLLBACK");
			return { ok: false, reason: "inactive" };
		}
		const inserted = await client.query(
			`INSERT INTO events (id, forge, delivery_id, raw_kind, raw) VALUES ($1, 'gitcafe', $2, 'schedule.matched', $3) ON CONFLICT (forge, delivery_id) DO NOTHING RETURNING id`,
			[job.eventId, event.deliveryId, JSON.stringify(event)],
		);
		if (inserted.rowCount === 1) {
			const queued = await boss.insert(
				GITCAFE_PROCESS_EVENT_QUEUE,
				[
					{
						id: generateId(),
						data: job,
						retryLimit: 10,
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
				throw new Error(
					"GitCafe scheduled event enqueue did not insert one job",
				);
		}
		await client.query("COMMIT");
		return { ok: true, inserted: inserted.rowCount === 1 };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/** A lifecycle generation alone cannot authorize a repository whose ownership claim has disappeared. */
export async function matchesGitCafeRepositoryBinding(
	db: DbLike,
	input: GitCafeRepositoryBinding,
): Promise<boolean> {
	const binding = gitCafeRepositoryBindingSchema.parse(input);
	const [row] = await db
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
				eq(repos.id, binding.repoId),
				eq(repos.forge, "gitcafe"),
				eq(repos.externalId, binding.repositoryId),
				eq(repos.fullName, binding.fullName),
				eq(repos.orgId, binding.organizationId),
				eq(repos.installationId, binding.installationId),
				sql`${repos.removedAt} IS NULL`,
			),
		);
	return (
		row !== undefined &&
		(
			await getGitCafeActionAuthority(
				db,
				binding.installationId,
				binding.generation,
			)
		).allowed
	);
}

/** Configuration changes share lifecycle and ownership locks; callers must hold a transaction. */
export async function lockGitCafeRepositoryAuthority(
	db: DbLike,
	repoId: string,
	organizationId?: string,
): Promise<{ binding: GitCafeRepositoryBinding; armed: boolean } | null> {
	await db.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
	);
	const [repo] = await db
		.select()
		.from(repos)
		.where(eq(repos.id, repoId))
		.for("update");
	if (
		!repo ||
		repo.forge !== "gitcafe" ||
		repo.removedAt ||
		!repo.installationId ||
		!repo.orgId ||
		(organizationId !== undefined && repo.orgId !== organizationId)
	)
		return null;
	const [claim] = await db
		.select({ id: organizationInstallations.id })
		.from(organizationInstallations)
		.where(
			and(
				eq(organizationInstallations.forge, "gitcafe"),
				eq(organizationInstallations.installationId, repo.installationId),
				eq(organizationInstallations.organizationId, repo.orgId),
			),
		)
		.for("update");
	const authority = await getGitCafeActionAuthority(db, repo.installationId);
	if (!claim || !authority.allowed) return null;
	return {
		armed: repo.armed,
		binding: gitCafeRepositoryBindingSchema.parse({
			repoId,
			organizationId: repo.orgId,
			installationId: repo.installationId,
			repositoryId: repo.externalId,
			fullName: repo.fullName,
			generation: authority.generation,
		}),
	};
}

/** Reconciliation and cache commits share a lock, so withdrawn or rebound authority cannot publish old reads. */
export async function commitGitCafeCatalogs(
	db: Db,
	binding: GitCafeRepositoryBinding,
	input: GitCafeCatalogValues,
): Promise<boolean> {
	gitCafeRepositoryBindingSchema.parse(binding);
	const values = gitCafeCatalogValuesSchema.parse(input);
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		await tx
			.select({ id: repos.id })
			.from(repos)
			.where(eq(repos.id, binding.repoId))
			.for("update");
		await tx
			.select({ id: organizationInstallations.id })
			.from(organizationInstallations)
			.where(
				and(
					eq(organizationInstallations.forge, "gitcafe"),
					eq(organizationInstallations.installationId, binding.installationId),
				),
			)
			.for("update");
		if (!(await matchesGitCafeRepositoryBinding(tx, binding))) return false;
		if (values.branches !== undefined)
			await upsertRepoSuggestions(
				tx,
				binding.repoId,
				"branches",
				values.branches,
			);
		if (values.labels !== undefined)
			await replaceRepoLabels(tx, binding.repoId, values.labels);
		if (values.reviewers !== undefined)
			await replaceGitCafeReviewerSuggestions(
				tx,
				binding.repoId,
				values.reviewers,
			);
		return true;
	});
}

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

/** Pending receipts outlive queue retry exhaustion and retention; only their missing lifecycle work is restored. */
export async function recoverPendingGitCafeReceipts(
	db: Db,
	boss: PgBoss,
): Promise<number> {
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL statement_timeout = '10s'");
		await client.query("SET LOCAL lock_timeout = '2s'");
		await client.query(
			"SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))",
		);
		const pending = await client.query<{ id: string; receipt: unknown }>(
			`SELECT r.id, r.receipt FROM gitcafe_receipts r
			 WHERE r.status = 'pending' AND (r.next_recovery_at IS NULL OR r.next_recovery_at <= now()) AND NOT EXISTS (
			   SELECT 1 FROM pgboss.job j WHERE j.name = $1
			   AND j.data->>'receiptId' = r.id AND j.state IN ('created', 'retry', 'active')
			 ) ORDER BY r.received_at, r.id LIMIT 100 FOR UPDATE OF r`,
			[GITCAFE_LIFECYCLE_QUEUE],
		);
		if (pending.rows.length > 0) {
			const jobs = [];
			for (const row of pending.rows) {
				const parsed = gitCafeReceiptSchema.safeParse(row.receipt);
				if (!parsed.success || !receiptBytesMatch(parsed.data)) {
					await client.query(
						"UPDATE gitcafe_receipts SET status = 'malformed', processed_at = now() WHERE id = $1",
						[row.id],
					);
					continue;
				}
				jobs.push({
					id: generateId(),
					data: gitCafeReceiptJobSchema.parse({
						receiptId: row.id,
						requestId: parsed.data.requestId,
					}),
					retryLimit: 5,
					retryDelay: 15,
					retryBackoff: true,
				});
				await client.query(
					`UPDATE gitcafe_receipts SET recovery_attempts = recovery_attempts + 1,
					next_recovery_at = now() + make_interval(secs => least(3600, 30 * power(2, least(recovery_attempts, 7)))::int) WHERE id = $1`,
					[row.id],
				);
			}
			if (jobs.length) {
				const inserted = await boss.insert(GITCAFE_LIFECYCLE_QUEUE, jobs, {
					returnId: true,
					db: {
						executeSql: (text: string, values?: unknown[]) =>
							client.query(text, values),
					},
				});
				if (inserted?.length !== jobs.length)
					throw new Error("GitCafe receipt recovery did not restore its jobs");
			}
		}
		await client.query("COMMIT");
		return pending.rows.length;
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

async function inspectRecoveryReceipt(
	client: Pick<PoolClient, "query">,
	selection: GitCafeRecoverySelection,
	receiptId: string,
): Promise<GitCafeRecoveryItem> {
	const result = await client.query<{
		status: GitCafeReceiptStatus;
		receipt: unknown;
		installation_id: string;
		event_id: string;
		event_type: string;
		delivery_id: string;
		received_at: Date;
	}>(
		"SELECT status, receipt, installation_id, event_id, event_type, delivery_id, received_at FROM gitcafe_receipts WHERE id = $1",
		[receiptId],
	);
	const row = result.rows[0];
	const item: GitCafeRecoveryItem = {
		receiptId,
		classification: "missing",
		status: row?.status ?? null,
		bodySha256: null,
		eventIds: [],
		runIds: [],
		providerEventId: row?.event_id ?? null,
		deliveryId: row?.delivery_id ?? null,
		eventType: row?.event_type ?? null,
		receivedAt: row?.received_at.toISOString() ?? null,
		events: [],
		jobs: [],
		actions: [],
	};
	if (!row) return item;
	const parsed = gitCafeReceiptSchema.safeParse(row.receipt);
	if (
		!parsed.success ||
		!receiptBytesMatch(parsed.data) ||
		parsed.data.payload.id !== row.event_id ||
		parsed.data.payload.type !== row.event_type ||
		parsed.data.payload.installation.id !== row.installation_id
	)
		return { ...item, classification: "quarantined" };
	item.bodySha256 = parsed.data.bodySha256;
	const payload = parsed.data.payload;
	const repository = payload.repository;
	if (
		row.installation_id !== selection.installationId ||
		parsed.data.appId !== selection.appId ||
		typeof repository !== "object" ||
		repository === null ||
		!("id" in repository) ||
		repository.id !== selection.repositoryId ||
		!("owner" in repository) ||
		typeof repository.owner !== "string" ||
		!("name" in repository) ||
		typeof repository.name !== "string"
	)
		return { ...item, classification: "binding-mismatch" };
	if (
		!(
			gitCafeDispatchableRepositoryEventTypeSchema.safeParse(row.event_type)
				.success || ["git.push", "check.rerequested"].includes(row.event_type)
		)
	)
		return { ...item, classification: "unsupported" };
	const binding = await client.query<{ id: string }>(
		`SELECT r.id FROM repos r JOIN organization_installations i ON i.forge = r.forge AND i.installation_id = r.installation_id AND i.organization_id = r.org_id JOIN gitcafe_installation_lifecycle l ON l.installation_id = r.installation_id WHERE r.forge = 'gitcafe' AND r.external_id = $1 AND r.installation_id = $2 AND r.org_id = $3 AND r.full_name = $4 AND r.removed_at IS NULL AND r.armed AND l.status = 'active' AND l.authority_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gitcafe_receipts revocation WHERE revocation.installation_id = r.installation_id AND revocation.status = 'pending' AND revocation.event_type IN ('installation.repositories_updated', 'installation.paused', 'installation.uninstalled'))`,
		[
			selection.repositoryId,
			selection.installationId,
			selection.organizationId,
			`${repository.owner}/${repository.name}`,
		],
	);
	if (binding.rowCount !== 1)
		return { ...item, classification: "revoked-authority" };
	const events = await client.query<{
		id: string;
		processed_at: Date | null;
		quarantined: boolean;
		processing_settlement: unknown;
		normalized_at: Date | null;
	}>(
		`SELECT id, normalized_at, processed_at, quarantined, processing_settlement FROM events WHERE forge = 'gitcafe' AND raw->>'id' = $1 AND raw#>>'{installation,id}' = $2 ORDER BY id`,
		[row.event_id, row.installation_id],
	);
	item.eventIds = events.rows.map((event) => event.id);
	item.events = events.rows.map((event) => ({
		id: event.id,
		normalized: event.normalized_at !== null,
		processed: event.processed_at !== null,
		quarantined: event.quarantined,
		settlement:
			gitCafeEventSettlementSchema.safeParse(event.processing_settlement)
				.data ?? null,
	}));
	const runs = await client.query<{ id: string }>(
		"SELECT id FROM runs WHERE event_id = ANY($1::text[]) ORDER BY id",
		[item.eventIds],
	);
	item.runIds = runs.rows.map((run) => run.id);
	const jobs = await client.query<{
		id: string;
		name: string;
		state: string;
		retry_count: number;
	}>(
		`SELECT id, name, state, retry_count FROM pgboss.job WHERE ((name = $1 AND data->>'receiptId' = $2) OR (name = $3 AND data->>'eventId' = ANY($4::text[]))) ORDER BY (state IN ('created', 'retry', 'active')) DESC, created_on DESC LIMIT 100`,
		[
			GITCAFE_LIFECYCLE_QUEUE,
			receiptId,
			GITCAFE_PROCESS_EVENT_QUEUE,
			item.eventIds,
		],
	);
	item.jobs = jobs.rows.map((job) => ({
		id: job.id,
		queue: job.name,
		state: job.state,
		attempts: job.retry_count,
	}));
	const actions = await client.query<{
		id: string;
		run_id: string;
		status: string;
		external_id: string | null;
	}>(
		"SELECT id, run_id, status, external_id FROM run_actions WHERE run_id = ANY($1::text[]) ORDER BY recorded_at DESC LIMIT 100",
		[item.runIds],
	);
	item.actions = actions.rows.map((action) => ({
		id: action.id,
		runId: action.run_id,
		status: action.status,
		externalId: action.external_id,
	}));
	if (
		jobs.rows.some((job) => ["created", "retry", "active"].includes(job.state))
	)
		item.classification = "already-pending";
	else if (
		row.status === "malformed" ||
		events.rows.some((event) => event.quarantined)
	)
		item.classification = "quarantined";
	else if (item.runIds.length) item.classification = "completed-with-run";
	else if (row.status === "parked")
		item.classification = "supported-but-parked";
	else if (
		events.rows.some(
			(event) =>
				event.processed_at !== null &&
				(() => {
					const settlement = gitCafeEventSettlementSchema.safeParse(
						event.processing_settlement,
					);
					return (
						settlement.success &&
						settlement.data.status === "skipped" &&
						!["legacy-unclassified", "unsupported-event"].includes(
							settlement.data.reason,
						)
					);
				})(),
		)
	)
		item.classification = "deliberately-skipped";
	else if (
		row.status === "applied" ||
		events.rows.some((event) => event.processed_at !== null)
	)
		item.classification = "completed-without-run";
	else if (["pending", "dispatched"].includes(row.status))
		item.classification = "eligible";
	else item.classification = "unsupported";
	return gitCafeRecoveryItemSchema.parse(item);
}

export async function planGitCafeReceiptRecovery(
	db: Db,
	input: GitCafeRecoverySelection,
): Promise<GitCafeRecoveryItem[]> {
	const selection = gitCafeRecoverySelectionSchema.parse(input);
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN READ ONLY");
		await client.query("SET LOCAL statement_timeout = '3s'");
		const items = [];
		for (const receiptId of new Set(selection.receiptIds))
			items.push(await inspectRecoveryReceipt(client, selection, receiptId));
		await client.query("COMMIT");
		return items;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/** Dispatch only freshly admitted signed receipts; historical parked deliveries remain inert. */
export async function dispatchGitCafeRepositoryReceipt(
	db: Db,
	boss: PgBoss,
	receiptId: string,
	operatorRequest?: GitCafeRecoveryRequest,
): Promise<GitCafeReceiptStatus | "lifecycle"> {
	const recovery = operatorRequest
		? gitCafeRecoveryRequestSchema.parse(operatorRequest)
		: null;
	if (recovery && !recovery.selection.receiptIds.includes(receiptId))
		throw new Error("Receipt is not explicitly selected for recovery");
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL statement_timeout = '10s'");
		await client.query("SET LOCAL lock_timeout = '2s'");
		await client.query(
			"SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))",
		);
		const found = await client.query<{
			installation_id: string;
			event_id: string;
			event_type: string;
			receipt: unknown;
			status: GitCafeReceiptStatus;
			received_at: Date;
		}>(
			"SELECT installation_id, event_id, event_type, receipt, status, received_at FROM gitcafe_receipts WHERE id = $1 FOR UPDATE",
			[receiptId],
		);
		const row = found.rows[0];
		if (!row) throw new Error("GitCafe receipt not found");
		if (recovery) {
			const previous = await client.query(
				"SELECT id FROM gitcafe_recovery_audit WHERE request_id = $1 AND receipt_id = $2",
				[recovery.requestId, receiptId],
			);
			if (previous.rowCount) {
				await client.query("COMMIT");
				return row.status;
			}
			const item = await inspectRecoveryReceipt(
				client,
				recovery.selection,
				receiptId,
			);
			const audit = gitCafeRecoveryAuditSchema.parse({
				requestId: recovery.requestId,
				operator: recovery.operator,
				reason: recovery.reason,
				selection: recovery.selection,
				receiptId,
				originalStatus: row.status,
				classification: item.classification,
				retryWithoutRun: recovery.retryWithoutRun,
				bodySha256: item.bodySha256,
				eventIds: item.eventIds,
				runIds: item.runIds,
				originalSettlements: item.events.map((event) => ({
					eventId: event.id,
					settlement: event.settlement,
				})),
			});
			await client.query(
				"INSERT INTO gitcafe_recovery_audit (id, receipt_id, request_id, audit) VALUES ($1, $2, $3, $4)",
				[generateId(), receiptId, recovery.requestId, JSON.stringify(audit)],
			);
			const retryNoRun =
				recovery.retryWithoutRun &&
				item.classification === "completed-without-run";
			if (
				!(
					["eligible", "supported-but-parked"].includes(item.classification) ||
					retryNoRun
				)
			) {
				await client.query("COMMIT");
				return row.status;
			}
			if (retryNoRun) {
				await client.query(
					"UPDATE events SET processed_at = NULL, processing_settlement = NULL, next_recovery_at = NULL WHERE id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM runs WHERE event_id = events.id)",
					[item.eventIds],
				);
			}
			await client.query(
				"UPDATE gitcafe_receipts SET status = 'pending', processed_at = NULL, next_recovery_at = NULL WHERE id = $1",
				[receiptId],
			);
			row.status = "pending";
		}
		if (row.status !== "pending") {
			await client.query("COMMIT");
			return row.status;
		}
		if (gitCafeLifecycleEventTypeSchema.safeParse(row.event_type).success) {
			await client.query("COMMIT");
			return "lifecycle";
		}
		const parsed = gitCafeReceiptSchema.safeParse(row.receipt);
		let status: GitCafeReceiptStatus = "malformed";
		if (
			parsed.success &&
			receiptBytesMatch(parsed.data) &&
			parsed.data.payload.installation.id === row.installation_id &&
			parsed.data.payload.id === row.event_id &&
			parsed.data.payload.type === row.event_type
		) {
			const receipt = parsed.data;
			if (
				!gitCafeDispatchableRepositoryEventTypeSchema.safeParse(row.event_type)
					.success &&
				row.event_type !== "check.rerequested" &&
				row.event_type !== "git.push"
			)
				status = "parked";
			else {
				const push =
					row.event_type === "git.push"
						? gitCafeCompletePushEventSchema.safeParse(receipt.payload)
						: null;
				const validPush = push?.success;
				const deliveries =
					push?.success && validPush
						? push.data.git.refUpdates.map((update) =>
								JSON.stringify(
									gitCafePushRefDeliverySchema.parse([
										row.installation_id,
										row.event_id,
										update.ref,
									]),
								),
							)
						: [JSON.stringify([row.installation_id, row.event_id])];
				if (push !== null && !validPush) status = "malformed";
				else {
					for (const delivery of deliveries) {
						const eventId = generateId();
						const inserted = await client.query<{ id: string }>(
							`INSERT INTO events (id, forge, delivery_id, raw_kind, raw, received_at)
					 VALUES ($1, 'gitcafe', $2, $3, $4, $5)
					 ON CONFLICT (forge, delivery_id) DO NOTHING RETURNING id`,
							[
								eventId,
								delivery,
								row.event_type,
								JSON.stringify(receipt.payload),
								row.received_at,
							],
						);
						if (inserted.rowCount === 1) {
							const queued = await boss.insert(
								GITCAFE_PROCESS_EVENT_QUEUE,
								[
									{
										id: generateId(),
										data: gitCafeProcessEventJobSchema.parse({
											eventId,
											requestId: receipt.requestId,
										}),
										retryLimit: 10,
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
								throw new Error("GitCafe event enqueue did not insert one job");
						} else if (recovery) {
							const existing = await client.query<{ id: string }>(
								"SELECT id FROM events WHERE forge = 'gitcafe' AND delivery_id = $1 AND processed_at IS NULL",
								[delivery],
							);
							const prior = existing.rows[0];
							if (prior)
								await boss.insert(
									GITCAFE_PROCESS_EVENT_QUEUE,
									[
										{
											id: generateId(),
											data: gitCafeProcessEventJobSchema.parse({
												eventId: prior.id,
												requestId: recovery.requestId,
											}),
											retryLimit: 10,
											retryDelay: 15,
											retryBackoff: true,
										},
									],
									{
										db: {
											executeSql: (text: string, values?: unknown[]) =>
												client.query(text, values),
										},
									},
								);
						}
					}
					if (push?.success && deliveries.length) {
						const [repo] = (
							await client.query<{ id: string }>(
								`SELECT r.id FROM repos r JOIN organization_installations i ON i.forge=r.forge AND i.installation_id=r.installation_id AND i.organization_id=r.org_id WHERE r.forge='gitcafe' AND r.external_id=$1 AND r.installation_id=$2 AND r.full_name=$3 AND r.removed_at IS NULL`,
								[
									push.data.repository.id,
									row.installation_id,
									`${push.data.repository.owner}/${push.data.repository.name}`,
								],
							)
						).rows;
						if (repo)
							await boss.insert(
								GITCAFE_REFRESH_CATALOGS_QUEUE,
								[
									{
										id: generateId(),
										data: gitCafeRefreshCatalogsJobSchema.parse({
											repoId: repo.id,
											requestId: receipt.requestId,
										}),
										singletonKey: repo.id,
									},
								],
								{
									db: {
										executeSql: (text: string, values?: unknown[]) =>
											client.query(text, values),
									},
								},
							);
					}
					status = deliveries.length ? "dispatched" : "applied";
				}
			}
		}
		await client.query(
			"UPDATE gitcafe_receipts SET status = $2, processed_at = now() WHERE id = $1",
			[receiptId, status],
		);
		await client.query("COMMIT");
		return status;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export async function finishGitCafeEvent(
	db: Db,
	eventId: string,
	input: GitCafeEventSettlement = {
		status: "skipped",
		reason: "legacy-unclassified",
	},
): Promise<void> {
	const settlement = gitCafeEventSettlementSchema.parse(input);
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))`,
		);
		await tx.execute(
			sql`UPDATE events SET processed_at = now(), processing_settlement = ${JSON.stringify(settlement)}::jsonb WHERE id = ${eventId} AND forge = 'gitcafe' AND processed_at IS NULL`,
		);
		await tx.execute(sql`UPDATE gitcafe_receipts r SET status = 'applied', processed_at = now()
			FROM events e WHERE e.id = ${eventId} AND e.forge = 'gitcafe' AND r.status = 'dispatched'
			AND e.raw->>'id' = r.event_id AND e.raw#>>'{installation,id}' = r.installation_id
			AND NOT EXISTS (SELECT 1 FROM events pending WHERE pending.forge = 'gitcafe'
			AND pending.raw->>'id' = r.event_id AND pending.raw#>>'{installation,id}' = r.installation_id AND pending.processed_at IS NULL)`);
	});
}

/** A durable dispatched receipt survives expired, exhausted, or retained-away process jobs. */
export async function recoverGitCafeEvents(
	db: Db,
	boss: PgBoss,
): Promise<number> {
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL statement_timeout = '10s'");
		await client.query("SET LOCAL lock_timeout = '2s'");
		await client.query(
			"SELECT pg_advisory_xact_lock(hashtext('gitcafe-connection'))",
		);
		/** Completion adoption and eligibility share one snapshot, including legacy workers settling queue jobs. */
		const pending = await client.query<{
			id: string;
			receipt: unknown;
			raw: unknown;
		}>(
			`WITH adopted AS (
			 UPDATE events e SET processed_at = completed.at FROM (
			 SELECT data->>'eventId' AS event_id, max(completed_on) AS at FROM pgboss.job
			 WHERE name = $1 AND state = 'completed' GROUP BY data->>'eventId'
			 ) completed WHERE e.id = completed.event_id AND e.forge = 'gitcafe'
			 AND e.processed_at IS NULL AND e.raw_kind = 'schedule.matched'
			 AND e.raw#>>'{thread,externalId}' IS NOT NULL AND completed.at IS NOT NULL
			 AND NOT EXISTS (SELECT 1 FROM gitcafe_receipts r WHERE e.raw->>'id' = r.event_id
			 AND e.raw#>>'{installation,id}' = r.installation_id) RETURNING e.id
			) SELECT e.id, r.receipt, e.raw FROM events e LEFT JOIN gitcafe_receipts r
			 ON e.raw->>'id' = r.event_id AND e.raw#>>'{installation,id}' = r.installation_id
			 WHERE e.forge = 'gitcafe' AND e.processed_at IS NULL AND
			 (e.next_recovery_at IS NULL OR e.next_recovery_at <= now()) AND
			 NOT EXISTS (SELECT 1 FROM adopted WHERE adopted.id = e.id) AND
			 (r.status IN ('dispatched', 'applied') OR r.id IS NULL) AND NOT EXISTS (
			 SELECT 1 FROM pgboss.job j WHERE j.name = $1 AND j.data->>'eventId' = e.id
			 AND j.state IN ('created','retry','active')) ORDER BY e.received_at, e.id LIMIT 100 FOR UPDATE OF e`,
			[GITCAFE_PROCESS_EVENT_QUEUE],
		);
		if (pending.rows.length) {
			const jobs = [];
			for (const row of pending.rows) {
				const receipt = gitCafeReceiptSchema.safeParse(row.receipt);
				if (row.receipt == null) {
					const event = scheduledEventSchema.safeParse(row.raw);
					if (
						!event.success ||
						event.data.forge !== "gitcafe" ||
						!event.data.thread.externalId
					) {
						await client.query(
							`UPDATE events SET quarantined = true, quarantine_reason = 'invalid-retained-data', processed_at = now(), processing_settlement = $2::jsonb WHERE id = $1`,
							[
								row.id,
								JSON.stringify(
									gitCafeEventSettlementSchema.parse({
										status: "quarantined",
										reason: "invalid-retained-data",
									}),
								),
							],
						);
						continue;
					}
				} else if (
					!receipt.success ||
					!receiptBytesMatch(receipt.data) ||
					!isDeepStrictEqual(receipt.data.payload, row.raw)
				) {
					await client.query(
						`UPDATE events SET quarantined = true, quarantine_reason = 'invalid-retained-data', processed_at = now(), processing_settlement = $2::jsonb WHERE id = $1`,
						[
							row.id,
							JSON.stringify(
								gitCafeEventSettlementSchema.parse({
									status: "quarantined",
									reason: "invalid-retained-data",
								}),
							),
						],
					);
					continue;
				}
				jobs.push({
					id: generateId(),
					data: gitCafeProcessEventJobSchema.parse({
						eventId: row.id,
						requestId:
							row.receipt == null
								? generateId()
								: receipt.success
									? receipt.data.requestId
									: generateId(),
					}),
					retryLimit: 10,
					retryDelay: 15,
					retryBackoff: true,
				});
				await client.query(
					`UPDATE events SET recovery_attempts = recovery_attempts + 1,
					next_recovery_at = now() + make_interval(secs => least(3600, 30 * power(2, least(recovery_attempts, 7)))::int) WHERE id = $1`,
					[row.id],
				);
			}
			if (jobs.length) {
				const inserted = await boss.insert(GITCAFE_PROCESS_EVENT_QUEUE, jobs, {
					returnId: true,
					db: {
						executeSql: (text: string, values?: unknown[]) =>
							client.query(text, values),
					},
				});
				if (inserted?.length !== jobs.length)
					throw new Error("GitCafe event recovery did not restore its jobs");
			}
		}
		await client.query(`UPDATE gitcafe_receipts r SET status = 'applied', processed_at = now()
			WHERE r.status = 'dispatched'
			AND EXISTS (SELECT 1 FROM events e WHERE e.forge = 'gitcafe' AND e.raw->>'id' = r.event_id AND e.raw#>>'{installation,id}' = r.installation_id)
			AND NOT EXISTS (SELECT 1 FROM events e WHERE e.forge = 'gitcafe' AND e.raw->>'id' = r.event_id AND e.raw#>>'{installation,id}' = r.installation_id AND e.processed_at IS NULL)`);
		await client.query("COMMIT");
		return pending.rows.length;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
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
				providerRevision: state.providerRevision,
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
