import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	gitCafeReceiptConfigSchema,
	gitCafeReceiptSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	gitCafeLifecycleServices,
	gitCafeOperationalServices,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { createApiHealth } from "./health.ts";

test("API health detects stopped protection with empty backlog, recovers, caches probes and emits bounded alerts", async () => {
	const container = await createTestDatabase();
	const { db, pool } = createDb(container.url);
	const boss = new PgBoss({
		connectionString: container.url,
		supervise: false,
		schedule: false,
	});
	const output: string[] = [];
	const logger = pino(
		{ level: "info" },
		{
			write(chunk: string) {
				output.push(chunk);
			},
		},
	);
	try {
		await applyMigrations(db);
		await boss.start();
		await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
		let now = Date.now();
		const config = gitCafeReceiptConfigSchema.parse({
			appId: GITCAFE_RECEIPT_APP_ID,
			keyVersion: "test",
			secret: "private-test-secret",
		});
		const health = createApiHealth(
			{
				auth: null,
				db,
				pool,
				directPool: pool,
				boss,
				logger,
				webhookSecret: "private-test-secret",
				gitCafeReceipts: config,
				webOrigin: "http://localhost",
			},
			() => now,
		);
		expect(await health.readHealth()).toMatchObject({
			status: 200,
			body: {
				live: true,
				ready: false,
				reason: "protection-heartbeat-missing",
			},
		});
		expect(await health.readReadiness()).toMatchObject({
			status: 503,
			body: {
				live: true,
				ready: false,
				reason: "protection-heartbeat-missing",
				stalledStages: ["heartbeat"],
			},
		});
		const runtimeId = generateId();
		await gitCafeOperationalServices.recordGitCafeRuntimeHeartbeat(db, {
			runtimeId,
			release: "test",
		});
		expect((await health.readReadiness()).status).toBe(503);
		now += 30_000;
		expect(await health.readReadiness()).toMatchObject({
			status: 200,
			body: { ready: true },
		});
		await pool.query(
			"UPDATE gitcafe_runtime_heartbeats SET progress_at = now() - interval '100 seconds'",
		);
		now += 30_000;
		expect(await health.readReadiness()).toMatchObject({
			status: 503,
			body: { stalledStages: ["heartbeat"] },
		});
		await gitCafeOperationalServices.recordGitCafeRuntimeHeartbeat(db, {
			runtimeId,
			release: "test",
		});
		now += 30_000;
		expect((await health.readReadiness()).status).toBe(200);
		const body = await Bun.file(
			new URL(
				"../../../packages/forge-gitcafe/fixtures/gitcafe-issue-created-webhook.json",
				import.meta.url,
			),
		).text();
		const admitted = await gitCafeLifecycleServices.insertGitCafeReceipt(
			pool,
			boss,
			gitCafeReceiptSchema.parse({
				format: "gitcafe-receipt@1",
				appId: GITCAFE_RECEIPT_APP_ID,
				payload: JSON.parse(body),
				bodyBase64: Buffer.from(body).toString("base64"),
				bodySha256: createHash("sha256").update(body).digest("hex"),
				deliveryId: "health-backlog",
				keyVersion: "test",
				signedAt: "1",
				requestId: generateId(),
			}),
		);
		await pool.query(
			"UPDATE gitcafe_receipts SET received_at = now() - interval '130 seconds' WHERE id = $1",
			[admitted.receiptId],
		);
		now += 30_000;
		expect((await health.readReadiness()).status).toBe(200);
		now += 30_000;
		expect(await health.readReadiness()).toMatchObject({
			status: 503,
			body: { stalledStages: ["receipt"] },
		});
		await pool.query(
			"UPDATE gitcafe_receipts SET status = 'parked' WHERE id = $1",
			[admitted.receiptId],
		);
		now += 30_000;
		expect((await health.readReadiness()).status).toBe(200);
		await pool.query("ALTER TABLE pgboss.job RENAME TO unavailable_job");
		now += 30_000;
		expect(await health.readHealth()).toMatchObject({
			status: 503,
			body: { live: true, reason: "dependencies-unavailable" },
		});
		await pool.query("ALTER TABLE pgboss.unavailable_job RENAME TO job");
		now += 30_000;
		expect((await health.readHealth()).status).toBe(200);
		const blocker = await pool.connect();
		try {
			await blocker.query("BEGIN");
			await blocker.query(
				"LOCK TABLE gitcafe_receipts IN ACCESS EXCLUSIVE MODE",
			);
			now += 30_000;
			const started = performance.now();
			expect((await health.readHealth()).status).toBe(503);
			expect(performance.now() - started).toBeLessThan(4_500);
		} finally {
			await blocker.query("ROLLBACK");
			blocker.release();
		}
		now += 30_000;
		expect((await health.readHealth()).status).toBe(200);
		const logs = output.join("");
		expect(logs).toContain("gitcafe.backlog.alert");
		expect(logs).toContain("gitcafe.backlog.recovered");
		for (const hidden of [
			runtimeId,
			"private-test-secret",
			"unavailable_job",
			"SELECT",
			"Error",
		])
			expect(logs).not.toContain(hidden);
	} finally {
		await boss.stop({ graceful: false, close: true });
		await pool.end();
		await container.stop();
	}
}, 120_000);
