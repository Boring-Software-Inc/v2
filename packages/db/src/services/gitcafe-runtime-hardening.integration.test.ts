import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	DEFAULT_WORKFLOW,
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	type GitCafeRecoverySelection,
	gitCafeIssueEventSchema,
	gitCafePermissionsAcceptedSchema,
	gitCafeReceiptSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { PgBoss } from "pg-boss";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	runServices,
	type TestDatabase,
} from "../index.ts";
import * as lifecycle from "./gitcafe-lifecycle.ts";
import * as operations from "./gitcafe-operations.ts";

const payload = gitCafeIssueEventSchema.parse(
	await Bun.file(
		new URL(
			"../../../forge-gitcafe/fixtures/gitcafe-issue-created-webhook.json",
			import.meta.url,
		),
	).json(),
);
const permissionsAccepted = gitCafePermissionsAcceptedSchema.parse(
	await Bun.file(
		new URL(
			"../../../forge-gitcafe/fixtures/gitcafe-installation-permissions-accepted.json",
			import.meta.url,
		),
	).json(),
);
let container: TestDatabase;
let database: ReturnType<typeof createDb>;
let boss: PgBoss;
let organizationId: string;

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
	boss = new PgBoss({
		connectionString: container.url,
		schedule: false,
		supervise: false,
	});
	await boss.start();
	await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
	await boss.createQueue(GITCAFE_PROCESS_EVENT_QUEUE);
}, 120_000);

beforeEach(async () => {
	await database.pool.query(
		"TRUNCATE gitcafe_receipts, gitcafe_recovery_audit, gitcafe_runtime_heartbeats, events, repos, organization, gitcafe_installation_lifecycle CASCADE",
	);
	await database.pool.query("TRUNCATE pgboss.job");
	organizationId = generateId();
	await database.pool.query(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Runtime test', $1)",
		[organizationId],
	);
	await database.pool.query(
		"INSERT INTO organization_installations (id, organization_id, forge, installation_id, account_login) VALUES ($1, $2, 'gitcafe', $3, $4)",
		[
			generateId(),
			organizationId,
			payload.installation.id,
			payload.repository.owner,
		],
	);
	await database.pool.query(
		"INSERT INTO repos (id, forge, external_id, owner, name, full_name, installation_id, org_id, armed) VALUES ($1, 'gitcafe', $2, $3, $4, $5, $6, $7, true)",
		[
			generateId(),
			payload.repository.id,
			payload.repository.owner,
			payload.repository.name,
			`${payload.repository.owner}/${payload.repository.name}`,
			payload.installation.id,
			organizationId,
		],
	);
	await database.pool.query(
		"INSERT INTO gitcafe_installation_lifecycle (installation_id, status, authority_at) VALUES ($1, 'active', now())",
		[payload.installation.id],
	);
});

afterAll(async () => {
	await boss?.stop({ graceful: false, close: true });
	await database?.pool.end();
	await container?.stop();
});

async function admit() {
	const body = JSON.stringify({ ...payload, id: `evt_${generateId()}` });
	const receipt = gitCafeReceiptSchema.parse({
		format: "gitcafe-receipt@1",
		appId: GITCAFE_RECEIPT_APP_ID,
		payload: JSON.parse(body),
		bodyBase64: Buffer.from(body).toString("base64"),
		bodySha256: createHash("sha256").update(body).digest("hex"),
		deliveryId: generateId(),
		keyVersion: "test",
		signedAt: "1",
		requestId: generateId(),
	});
	return {
		...(await lifecycle.insertGitCafeReceipt(database.pool, boss, receipt)),
		receipt,
	};
}

async function admitPermissionsAccepted() {
	const body = JSON.stringify(permissionsAccepted);
	const receipt = gitCafeReceiptSchema.parse({
		format: "gitcafe-receipt@1",
		appId: GITCAFE_RECEIPT_APP_ID,
		payload: permissionsAccepted,
		bodyBase64: Buffer.from(body).toString("base64"),
		bodySha256: createHash("sha256").update(body).digest("hex"),
		deliveryId: generateId(),
		keyVersion: "test",
		signedAt: "1",
		requestId: generateId(),
	});
	return lifecycle.insertGitCafeReceipt(database.pool, boss, receipt);
}

function selection(receiptIds: string[]): GitCafeRecoverySelection {
	return {
		environment: "preview",
		appId: GITCAFE_RECEIPT_APP_ID,
		organizationId,
		installationId: payload.installation.id,
		repositoryId: payload.repository.id,
		receiptIds,
	};
}

function request(receiptIds: string[], retryWithoutRun = false) {
	return {
		selection: selection(receiptIds),
		operator: "runtime-integration",
		reason: "Verify retained receipt recovery",
		requestId: generateId(),
		retryWithoutRun,
	};
}

async function jobs(queue: string) {
	return (
		await database.pool.query<{
			id: string;
			data: Record<string, string>;
			state: string;
		}>("SELECT id, data, state FROM pgboss.job WHERE name = $1 ORDER BY id", [
			queue,
		])
	).rows;
}

test("migration chain is additive and idempotent, and legacy applied rows keep unknown settlement", async () => {
	await applyMigrations(database.db);
	const admitted = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	const id = (await jobs(GITCAFE_PROCESS_EVENT_QUEUE))[0]?.data.eventId;
	await database.pool.query(
		"UPDATE events SET processed_at = now() WHERE id = $1",
		[id],
	);
	await database.pool.query(
		"UPDATE gitcafe_receipts SET status = 'applied' WHERE id = $1",
		[admitted.receiptId],
	);
	await database.pool.query("TRUNCATE pgboss.job");
	expect(
		(
			await lifecycle.planGitCafeReceiptRecovery(
				database.db,
				selection([admitted.receiptId]),
			)
		)[0]?.classification,
	).toBe("completed-without-run");
	expect(
		(
			await database.pool.query(
				"SELECT processing_settlement FROM events WHERE id = $1",
				[id],
			)
		).rows[0]?.processing_settlement,
	).toBeNull();
});

test("oldest invalid retained receipt is quarantined without starving >100 healthy receipts", async () => {
	const poison = await admit();
	await database.pool.query(
		"UPDATE gitcafe_receipts SET receipt = '{}'::jsonb, received_at = now() - interval '1 day' WHERE id = $1",
		[poison.receiptId],
	);
	for (let i = 0; i < 105; i++) await admit();
	await database.pool.query("TRUNCATE pgboss.job");
	expect(await lifecycle.recoverPendingGitCafeReceipts(database.db, boss)).toBe(
		100,
	);
	expect(await lifecycle.recoverPendingGitCafeReceipts(database.db, boss)).toBe(
		6,
	);
	expect(await jobs(GITCAFE_LIFECYCLE_QUEUE)).toHaveLength(105);
	expect(
		(
			await database.pool.query(
				"SELECT status FROM gitcafe_receipts WHERE id = $1",
				[poison.receiptId],
			)
		).rows[0]?.status,
	).toBe("malformed");
	expect(await lifecycle.recoverPendingGitCafeReceipts(database.db, boss)).toBe(
		0,
	);
}, 30_000);

test("newly supported lifecycle events recover from their retained parked receipt", async () => {
	await database.pool.query(
		"INSERT INTO gitcafe_installation_lifecycle (installation_id, status, authority_at, provider_revision) VALUES ($1, 'active', $2, 4)",
		[permissionsAccepted.installation.id, new Date("2026-11-22T05:00:00.000Z")],
	);
	const admitted = await admitPermissionsAccepted();
	await database.pool.query(
		"UPDATE gitcafe_receipts SET status = 'parked', processed_at = now() WHERE id = $1",
		[admitted.receiptId],
	);
	await database.pool.query("TRUNCATE pgboss.job");
	expect(await lifecycle.recoverPendingGitCafeReceipts(database.db, boss)).toBe(
		1,
	);
	expect(await jobs(GITCAFE_LIFECYCLE_QUEUE)).toHaveLength(1);
	expect(
		(
			await database.pool.query(
				"SELECT status, processed_at FROM gitcafe_receipts WHERE id = $1",
				[admitted.receiptId],
			)
		).rows[0],
	).toMatchObject({ status: "pending", processed_at: null });
	expect(
		await lifecycle.processGitCafeReceipt(database.db, admitted.receiptId),
	).toBe("applied");
});

test("two recovery replicas preserve one live event job and back off retained-away work", async () => {
	const admitted = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	await database.pool.query("DELETE FROM pgboss.job WHERE name = $1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	const counts = await Promise.all([
		lifecycle.recoverGitCafeEvents(database.db, boss),
		lifecycle.recoverGitCafeEvents(database.db, boss),
	]);
	expect(counts.sort()).toEqual([0, 1]);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(1);
	await database.pool.query("DELETE FROM pgboss.job WHERE name = $1", [
		GITCAFE_PROCESS_EVENT_QUEUE,
	]);
	expect(await lifecycle.recoverGitCafeEvents(database.db, boss)).toBe(0);
	await database.pool.query(
		"UPDATE events SET next_recovery_at = now() - interval '1 second'",
	);
	expect(await lifecycle.recoverGitCafeEvents(database.db, boss)).toBe(1);
	expect(
		(
			await database.pool.query(
				"SELECT recovery_attempts, next_recovery_at > now() + interval '55 seconds' AS backed_off FROM events",
			)
		).rows[0],
	).toMatchObject({ recovery_attempts: 2, backed_off: true });
});

test("settlement is durable and idempotent; evaluation completion leaves recorded effects independent", async () => {
	const admitted = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	const eventId = (await jobs(GITCAFE_PROCESS_EVENT_QUEUE))[0]?.data.eventId;
	if (!eventId) throw new Error("Expected dispatched event");
	await lifecycle.finishGitCafeEvent(database.db, eventId, {
		status: "skipped",
		reason: "self",
	});
	await lifecycle.finishGitCafeEvent(database.db, eventId, {
		status: "skipped",
		reason: "unarmed",
	});
	expect(
		(
			await database.pool.query(
				"SELECT processing_settlement FROM events WHERE id = $1",
				[eventId],
			)
		).rows[0]?.processing_settlement,
	).toEqual({ status: "skipped", reason: "self" });
	expect(
		(
			await database.pool.query(
				"SELECT status FROM gitcafe_receipts WHERE id = $1",
				[admitted.receiptId],
			)
		).rows[0]?.status,
	).toBe("applied");
});

test("dry-run is read-only; explicit parked recovery retains exact admitted bytes and audits once", async () => {
	const admitted = await admit();
	await database.pool.query(
		"UPDATE gitcafe_receipts SET status = 'parked' WHERE id = $1",
		[admitted.receiptId],
	);
	await database.pool.query("TRUNCATE pgboss.job");
	const before = (
		await database.pool.query("SELECT * FROM gitcafe_receipts WHERE id = $1", [
			admitted.receiptId,
		])
	).rows;
	expect(
		(
			await lifecycle.planGitCafeReceiptRecovery(
				database.db,
				selection([admitted.receiptId]),
			)
		)[0]?.classification,
	).toBe("supported-but-parked");
	expect(
		(
			await database.pool.query(
				"SELECT * FROM gitcafe_receipts WHERE id = $1",
				[admitted.receiptId],
			)
		).rows,
	).toEqual(before);
	expect(
		(await database.pool.query("SELECT * FROM gitcafe_recovery_audit"))
			.rowCount,
	).toBe(0);
	const recovery = request([admitted.receiptId]);
	expect(
		await lifecycle.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
			recovery,
		),
	).toBe("dispatched");
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
		recovery,
	);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(1);
	expect(
		(
			await database.pool.query(
				"SELECT receipt FROM gitcafe_receipts WHERE id = $1",
				[admitted.receiptId],
			)
		).rows[0]?.receipt,
	).toEqual(admitted.receipt);
	expect(
		(await database.pool.query("SELECT audit FROM gitcafe_recovery_audit"))
			.rows[0]?.audit,
	).toMatchObject({
		operator: recovery.operator,
		originalStatus: "parked",
		requestId: recovery.requestId,
	});
	expect(
		(await database.pool.query("SELECT * FROM gitcafe_recovery_audit"))
			.rowCount,
	).toBe(1);
});

for (const trap of [
	"repository",
	"organization",
	"installation",
	"digest",
	"revocation",
] as const) {
	test(`retained recovery refuses ${trap} mismatch without dispatch`, async () => {
		const admitted = await admit();
		await database.pool.query(
			"UPDATE gitcafe_receipts SET status = 'parked' WHERE id = $1",
			[admitted.receiptId],
		);
		await database.pool.query("TRUNCATE pgboss.job");
		const recovery = request([admitted.receiptId]);
		if (trap === "repository") recovery.selection.repositoryId = "repo_other";
		if (trap === "organization")
			recovery.selection.organizationId = generateId();
		if (trap === "installation")
			recovery.selection.installationId = "ins_other";
		if (trap === "digest")
			await database.pool.query(
				"UPDATE gitcafe_receipts SET receipt = jsonb_set(receipt, '{bodySha256}', to_jsonb(repeat('0', 64))) WHERE id = $1",
				[admitted.receiptId],
			);
		if (trap === "revocation")
			await database.pool.query(
				"UPDATE gitcafe_installation_lifecycle SET status = 'paused'",
			);
		expect(
			await lifecycle.dispatchGitCafeRepositoryReceipt(
				database.db,
				boss,
				admitted.receiptId,
				recovery,
			),
		).toBe("parked");
		expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(0);
		expect((await database.pool.query("SELECT * FROM events")).rowCount).toBe(
			0,
		);
	});
}

test("processed no-run recovery requires explicit selection and cannot restart an intentional skip", async () => {
	const admitted = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	const eventId = (await jobs(GITCAFE_PROCESS_EVENT_QUEUE))[0]?.data.eventId;
	if (!eventId) throw new Error("Expected dispatched event");
	await lifecycle.finishGitCafeEvent(database.db, eventId, {
		status: "skipped",
		reason: "legacy-unclassified",
	});
	await database.pool.query("TRUNCATE pgboss.job");
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
		request([admitted.receiptId]),
	);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(0);
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
		request([admitted.receiptId], true),
	);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(1);
	await lifecycle.finishGitCafeEvent(database.db, eventId, {
		status: "skipped",
		reason: "maintainer-exemption",
	});
	await database.pool.query("TRUNCATE pgboss.job");
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
		request([admitted.receiptId], true),
	);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(0);
});

test("operational summary sees durable backlog without jobs and detects absent/stopped heartbeat", async () => {
	const admitted = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	await database.pool.query("TRUNCATE pgboss.job");
	await database.pool.query(
		"UPDATE gitcafe_receipts SET received_at = now() - interval '130 seconds'",
	);
	const summary = await operations.readGitCafeOperationalSummary(database.db);
	expect(summary).toMatchObject({
		dispatchedReceipts: 1,
		unprocessedEvents: 1,
		eventsWithoutLiveJobs: 1,
		heartbeatAgeSeconds: null,
	});
	expect(summary.oldestReceiptAgeSeconds).toBeGreaterThan(120);
	const runtimeId = generateId();
	await operations.recordGitCafeRuntimeHeartbeat(database.db, {
		runtimeId,
		release: "test-release",
	});
	expect(
		(await operations.readGitCafeOperationalSummary(database.db))
			.heartbeatAgeSeconds,
	).toBeLessThan(5);
	await operations.removeGitCafeRuntimeHeartbeat(database.db, runtimeId);
	expect(
		(await operations.readGitCafeOperationalSummary(database.db))
			.heartbeatAgeSeconds,
	).toBeNull();
});

test("concurrent operator requests produce one live evaluation and never reset an existing run", async () => {
	const admitted = await admit();
	await database.pool.query(
		"UPDATE gitcafe_receipts SET status = 'parked' WHERE id = $1",
		[admitted.receiptId],
	);
	await database.pool.query("TRUNCATE pgboss.job");
	await Promise.all([
		lifecycle.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
			request([admitted.receiptId]),
		),
		lifecycle.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
			request([admitted.receiptId]),
		),
	]);
	const found = await jobs(GITCAFE_PROCESS_EVENT_QUEUE);
	expect(found).toHaveLength(1);
	const eventId = found[0]?.data.eventId;
	if (!eventId) throw new Error("Expected dispatched event");
	const runId = await runServices.createRun(database.db, {
		eventId,
		repoFullName: `${payload.repository.owner}/${payload.repository.name}`,
		subjectNumber: payload.issue.number,
		headSha: null,
		snapshot: [DEFAULT_WORKFLOW],
		status: "completed",
		verdict: "pass",
	});
	await lifecycle.finishGitCafeEvent(database.db, eventId, {
		status: "completed",
		runId,
	});
	await database.pool.query("TRUNCATE pgboss.job");
	expect(
		(
			await lifecycle.planGitCafeReceiptRecovery(
				database.db,
				selection([admitted.receiptId]),
			)
		)[0]?.classification,
	).toBe("completed-with-run");
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
		request([admitted.receiptId], true),
	);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(0);
	expect(
		(
			await database.pool.query("SELECT id FROM runs WHERE event_id = $1", [
				eventId,
			])
		).rows,
	).toEqual([{ id: runId }]);
});

test("one invalid retained event quarantines and settles its receipt without poisoning a healthy sibling", async () => {
	const poison = await admit();
	const healthy = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		poison.receiptId,
	);
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		healthy.receiptId,
	);
	await database.pool.query("TRUNCATE pgboss.job");
	await database.pool.query(
		"UPDATE events SET raw = jsonb_set(raw, '{issue,title}', to_jsonb('retained-test-tamper'::text)) WHERE raw->>'id' = $1",
		[poison.receipt.payload.id],
	);
	expect(await lifecycle.recoverGitCafeEvents(database.db, boss)).toBe(2);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(1);
	expect(
		(
			await database.pool.query(
				"SELECT processing_settlement, quarantined FROM events WHERE raw->>'id' = $1",
				[poison.receipt.payload.id],
			)
		).rows[0],
	).toMatchObject({
		processing_settlement: {
			status: "quarantined",
			reason: "invalid-retained-data",
		},
		quarantined: true,
	});
	expect(
		(
			await database.pool.query(
				"SELECT status FROM gitcafe_receipts WHERE id = $1",
				[poison.receiptId],
			)
		).rows[0]?.status,
	).toBe("applied");
});

test("invalid retained schedule event cannot stall recovery readiness", async () => {
	const eventId = generateId();
	await database.pool.query(
		`INSERT INTO events (id, forge, delivery_id, raw_kind, raw, received_at)
		 VALUES ($1, 'gitcafe', $2, 'schedule.matched', $3, now() - interval '5 minutes')`,
		[
			eventId,
			JSON.stringify(["schedule", generateId()]),
			JSON.stringify({
				id: generateId(),
				forge: "gitcafe",
				thread: {},
			}),
		],
	);

	expect(await lifecycle.recoverGitCafeEvents(database.db, boss)).toBe(1);
	expect(
		(
			await database.pool.query(
				"SELECT processed_at IS NOT NULL AS processed, quarantined, quarantine_reason, processing_settlement FROM events WHERE id = $1",
				[eventId],
			)
		).rows[0],
	).toEqual({
		processed: true,
		quarantined: true,
		quarantine_reason: "invalid-retained-data",
		processing_settlement: {
			status: "quarantined",
			reason: "invalid-retained-data",
		},
	});
	expect(
		(await operations.readGitCafeOperationalSummary(database.db))
			.unprocessedEvents,
	).toBe(0);
});

test("orphaned forge event cannot stall recovery readiness", async () => {
	const eventId = generateId();
	await database.pool.query(
		`INSERT INTO events (id, forge, delivery_id, raw_kind, raw, received_at)
		 VALUES ($1, 'gitcafe', $2, 'issue.created', $3, now() - interval '5 minutes')`,
		[
			eventId,
			JSON.stringify([payload.installation.id, generateId()]),
			JSON.stringify({ ...payload, id: `evt_${generateId()}` }),
		],
	);

	expect(await lifecycle.recoverGitCafeEvents(database.db, boss)).toBe(1);
	expect(
		(
			await database.pool.query(
				"SELECT processed_at IS NOT NULL AS processed, quarantined, quarantine_reason FROM events WHERE id = $1",
				[eventId],
			)
		).rows[0],
	).toEqual({
		processed: true,
		quarantined: true,
		quarantine_reason: "invalid-retained-data",
	});
});

test("applied receipt with an unsettled event is replayed", async () => {
	const admitted = await admit();
	await lifecycle.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	await database.pool.query("TRUNCATE pgboss.job");
	await database.pool.query(
		"UPDATE gitcafe_receipts SET status = 'applied' WHERE id = $1",
		[admitted.receiptId],
	);

	expect(await lifecycle.recoverGitCafeEvents(database.db, boss)).toBe(1);
	expect(await jobs(GITCAFE_PROCESS_EVENT_QUEUE)).toHaveLength(1);
});
