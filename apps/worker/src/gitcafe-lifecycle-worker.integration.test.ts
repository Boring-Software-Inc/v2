import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	gitCafeEventEnvelopeSchema,
	gitCafeReceiptSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	gitCafeLifecycleServices,
	PROCESS_EVENT_QUEUE,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { registerGitCafeLifecycleConsumer } from "./gitcafe-lifecycle-worker.ts";

test("isolated lifecycle consumer processes durable receipts and leaves general backlog and schedules alone", async () => {
	const container = await createTestDatabase();
	const { db, pool } = createDb(container.url);
	let boss: PgBoss | undefined;
	try {
		await applyMigrations(db);
		const bootstrap = new PgBoss({
			connectionString: container.url,
			schedule: false,
			supervise: false,
		});
		await bootstrap.start();
		await bootstrap.createQueue(PROCESS_EVENT_QUEUE);
		const backlogId = await bootstrap.send(PROCESS_EVENT_QUEUE, {
			eventId: generateId(),
		});
		await bootstrap.stop({ close: true, graceful: false });
		const logger = pino({ level: "silent" });
		boss = await gitCafeLifecycleServices.createGitCafeLifecycleBoss(
			container.url,
			logger,
		);
		const body = await Bun.file(
			new URL(
				"../../../packages/forge-gitcafe/fixtures/gitcafe-installation-created.json",
				import.meta.url,
			),
		).text();
		const receipt = gitCafeReceiptSchema.parse({
			format: "gitcafe-receipt@1",
			appId: GITCAFE_RECEIPT_APP_ID,
			payload: gitCafeEventEnvelopeSchema.parse(JSON.parse(body)),
			bodyBase64: Buffer.from(body).toString("base64"),
			bodySha256: createHash("sha256").update(body).digest("hex"),
			deliveryId: "internal-consumer-test",
			keyVersion: "local-test-1",
			signedAt: String(Math.floor(Date.now() / 1000)),
			requestId: generateId(),
		});
		const admitted = await gitCafeLifecycleServices.insertGitCafeReceipt(
			pool,
			boss,
			receipt,
		);
		await registerGitCafeLifecycleConsumer(db, boss, logger);
		const deadline = Date.now() + 10_000;
		let state: string | undefined;
		while (Date.now() < deadline) {
			const jobs = await pool.query<{ state: string }>(
				"SELECT state FROM pgboss.job WHERE name = $1",
				[GITCAFE_LIFECYCLE_QUEUE],
			);
			state = jobs.rows[0]?.state;
			if (state === "completed" || state === "failed") break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(state).toBe("completed");
		expect(
			(
				await pool.query<{ status: string }>(
					"SELECT status FROM gitcafe_receipts WHERE id = $1",
					[admitted.receiptId],
				)
			).rows[0]?.status,
		).toBe("applied");
		expect(
			(
				await pool.query<{ state: string }>(
					"SELECT state FROM pgboss.job WHERE id = $1",
					[backlogId],
				)
			).rows[0]?.state,
		).toBe("created");
		expect(
			(await pool.query("SELECT name FROM pgboss.schedule")).rowCount,
		).toBe(0);
		for (const table of ["events", "repos", "runs", "run_actions"])
			expect((await pool.query(`SELECT id FROM ${table}`)).rowCount).toBe(0);
	} finally {
		await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
		await pool.end();
		await container.stop();
	}
}, 120_000);
