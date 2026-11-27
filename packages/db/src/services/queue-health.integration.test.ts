import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PgBoss } from "pg-boss";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	GITHUB_EVALUATE_QUEUE,
	type TestDatabase,
} from "../index.ts";
import { workerDeployments } from "../schema/workers.ts";
import { deliveryAuditStore } from "./delivery-audit.ts";
import {
	oldestReadyAgeSeconds,
	readQueueHealth,
	recordAlertState,
} from "./queue-health.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let boss: PgBoss;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

test("queue health reads the waiting backlog and the worker's last check-in", async () => {
	const empty = await readQueueHealth(db);
	expect(empty).toMatchObject({
		evaluateReady: 0,
		evaluateAgeSeconds: 0,
		deadLetteredLastDay: 0,
		lostDeliveriesLastDay: 0,
		workerHeartbeatAgeSeconds: null,
	});

	await boss.send(GITHUB_EVALUATE_QUEUE, { eventId: "e1" });
	await db.execute(
		`UPDATE pgboss.job SET start_after = now() - interval '10 minutes' WHERE name = '${GITHUB_EVALUATE_QUEUE}'`,
	);
	await db.insert(workerDeployments).values({
		deploymentId: "d1",
		lastHeartbeatAt: new Date(Date.now() - 4 * 60_000),
	});

	const health = await readQueueHealth(db);
	expect(health.evaluateReady).toBe(1);
	expect(health.evaluateAgeSeconds).toBeGreaterThan(590);
	expect(health.workerHeartbeatAgeSeconds).toBeGreaterThan(230);
	expect(
		await oldestReadyAgeSeconds(db, GITHUB_EVALUATE_QUEUE),
	).toBeGreaterThan(590);
});

test("only the call that flips an alert reports it", async () => {
	expect(await recordAlertState(db, "a", false)).toBeNull();
	expect(await recordAlertState(db, "a", true)).toMatchObject({ firing: true });
	// Another replica sampling the same minute sees no change.
	expect(await recordAlertState(db, "a", true)).toBeNull();
	const cleared = await recordAlertState(db, "a", false);
	expect(cleared?.firing).toBe(false);
	expect(cleared?.sinceSeconds).toBeGreaterThanOrEqual(0);
	expect(await recordAlertState(db, "b", true)).toEqual({
		firing: true,
		sinceSeconds: null,
	});
});

test("lost GitHub deliveries count until they recover", async () => {
	const lost = async () => (await readQueueHealth(db)).lostDeliveriesLastDay;
	const store = deliveryAuditStore(db);
	const problem = {
		guid: "guid-health",
		attemptId: 1,
		event: "pull_request",
		action: "opened",
		installationId: "1",
		repositoryId: "1",
		deliveredAt: new Date(),
		statusCode: 200,
	};
	await store.recordDeliveryProblem({ ...problem, status: "redelivered" });
	await store.recordDeliveryProblem({
		...problem,
		guid: "guid-noop",
		status: "ignored",
	});
	expect(await lost()).toBe(0);
	await store.recordDeliveryProblem({ ...problem, status: "missed" });
	expect(await lost()).toBe(1);
	await store.setDeliveryProblemStatus("guid-health", "recovered");
	expect(await lost()).toBe(0);
});
