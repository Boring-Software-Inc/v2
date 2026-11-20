import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	PROCESS_EVENT_QUEUE,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { startGitCafeProtectionRuntime } from "./gitcafe-protection-worker.ts";

for (const mode of ["standard", "gitcafe-protection"] as const) {
	test(`${mode} runtime registers its consumers, detects their loss, and cleans up only its own resources`, async () => {
		const container = await createTestDatabase();
		const { db, pool } = createDb(container.url);
		const boss = new PgBoss({
			connectionString: container.url,
			schedule: false,
			supervise: false,
		});
		const environment = {
			WORKER_MODE: mode,
			UNKEY_ENVIRONMENT_SLUG: "preview",
			GITCAFE_WEBHOOK_RECEIPTS_ENABLED: "true",
			GITCAFE_APP_ID: GITCAFE_RECEIPT_APP_ID,
			GITCAFE_APP_KEY_ID: "local-test",
			GITCAFE_APP_PRIVATE_KEY: generateKeyPairSync("ed25519")
				.privateKey.export({ type: "pkcs8", format: "pem" })
				.toString(),
			DATABASE_URL: container.url,
			DATABASE_URL_DIRECT: container.url,
		};
		const previous = Object.fromEntries(
			Object.keys(environment).map((key) => [key, process.env[key]]),
		);
		let runtime: Awaited<ReturnType<typeof startGitCafeProtectionRuntime>>;
		try {
			Object.assign(process.env, environment);
			await applyMigrations(db);
			await boss.start();
			await boss.createQueue(PROCESS_EVENT_QUEUE);
			const backlog = await boss.send(PROCESS_EVENT_QUEUE, {
				eventId: generateId(),
			});
			runtime = await startGitCafeProtectionRuntime(
				pino({ level: "silent" }),
				mode === "standard" ? boss : undefined,
			);
			expect(runtime?.healthy()).toBe(true);
			if (mode === "standard") {
				expect(
					boss
						.getWipData()
						.filter((worker) => worker.name === GITCAFE_PROCESS_EVENT_QUEUE),
				).toHaveLength(1);
				await boss.offWork(GITCAFE_PROCESS_EVENT_QUEUE);
				expect(runtime?.healthy()).toBe(false);
			}
			await runtime?.stop();
			expect(runtime?.healthy()).toBe(false);
			expect(
				(await boss.getJobById(PROCESS_EVENT_QUEUE, backlog ?? ""))?.state,
			).toBe("created");
			expect(
				await boss.send(PROCESS_EVENT_QUEUE, { eventId: generateId() }),
			).toBeString();
			expect(
				(await pool.query("SELECT * FROM gitcafe_runtime_heartbeats")).rowCount,
			).toBe(0);
		} finally {
			await boss.stop({ graceful: false, close: true });
			await pool.end();
			await container.stop();
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	}, 120_000);
}
