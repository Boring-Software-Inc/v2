import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	GITCAFE_CONNECT_QUEUE,
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	gitCafeEventEnvelopeSchema,
	gitCafeInstallationSchema,
	gitCafeReceiptSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createGitCafeConnectionBoss,
	createTestDatabase,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	PROCESS_EVENT_QUEUE,
	repos,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { registerGitCafeConnectionQueues } from "./gitcafe-connection-worker.ts";
import { registerGitCafeLifecycleConsumer } from "./gitcafe-lifecycle-consumer.ts";

const unavailableClient = {
	getInstallation: async () => ({
		ok: false as const,
		reason: "http" as const,
		status: 403,
	}),
	getOrganizationMembers: async () => ({
		ok: false as const,
		reason: "http" as const,
		status: 403,
	}),
	getRepositories: async () => ({
		ok: false as const,
		reason: "http" as const,
		status: 403,
	}),
};

for (const mode of ["standalone", "combined"] as const) {
	test(`isolated ${mode} consumer processes durable receipts and leaves general backlog and schedules alone`, async () => {
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
			boss = await (mode === "standalone"
				? gitCafeLifecycleServices.createGitCafeLifecycleBoss
				: createGitCafeConnectionBoss)(container.url, logger);
			if (mode === "combined") await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
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
			let connectionJobId: string | null = null;
			if (mode === "standalone")
				await registerGitCafeLifecycleConsumer(db, boss, logger);
			else {
				connectionJobId = await boss.send(GITCAFE_CONNECT_QUEUE, {
					invalid: true,
				});
				const registration = await registerGitCafeConnectionQueues(
					{ db, client: unavailableClient, lifecycleEnabled: true },
					boss,
					logger,
				);
				expect(registration.queues).toEqual([
					GITCAFE_CONNECT_QUEUE,
					GITCAFE_LIFECYCLE_QUEUE,
				]);
				expect(registration.health.healthy).toBe(true);
				boss.emit("error", new Error("local test queue failure"));
				expect(registration.health.healthy).toBe(false);
			}
			const deadline = Date.now() + 10_000;
			let state: string | undefined;
			while (Date.now() < deadline) {
				const jobs = await pool.query<{ state: string }>(
					"SELECT state FROM pgboss.job WHERE name = $1 ORDER BY created_on DESC, id DESC LIMIT 1",
					[GITCAFE_LIFECYCLE_QUEUE],
				);
				state = jobs.rows[0]?.state;
				if (state === "completed" || state === "failed") break;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(state).toBe("completed");
			if (connectionJobId) {
				const completed = await boss.getJobById(
					GITCAFE_CONNECT_QUEUE,
					connectionJobId,
				);
				expect(completed?.state).toBe("completed");
				expect(completed?.output).toEqual({ ok: false, reason: "invalid-job" });
			}
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
}

test("combined registration refuses missing lifecycle schema while legacy connection mode still registers alone", async () => {
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
		await bootstrap.stop({ close: true, graceful: false });
		const logger = pino({ level: "silent" });
		boss = await createGitCafeConnectionBoss(container.url, logger);
		await pool.query(
			"ALTER TABLE gitcafe_receipts RENAME TO unavailable_receipts",
		);
		await expect(
			registerGitCafeConnectionQueues(
				{ db, client: unavailableClient, lifecycleEnabled: true },
				boss,
				logger,
			),
		).rejects.toThrow();
		expect(
			(
				await pool.query("SELECT name FROM pgboss.queue WHERE name = $1", [
					GITCAFE_LIFECYCLE_QUEUE,
				])
			).rowCount,
		).toBe(0);
		const registration = await registerGitCafeConnectionQueues(
			{ db, client: unavailableClient, lifecycleEnabled: false },
			boss,
			logger,
		);
		expect(registration.queues).toEqual([GITCAFE_CONNECT_QUEUE]);
		expect(registration.health.healthy).toBe(true);
		await boss.stop({ close: true, graceful: false });
		expect(registration.health.healthy).toBe(false);
	} finally {
		await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
		await pool.end();
		await container.stop();
	}
}, 120_000);

for (const recoveryCase of [
	"single-crash",
	"retry-exhaustion",
	"retained-receipt",
] as const) {
	test(`${recoveryCase} uninstall recovery preserves general jobs and metadata byte for byte`, async () => {
		const container = await createTestDatabase();
		const { db, pool } = createDb(container.url);
		let producer: PgBoss | undefined;
		let restarted: PgBoss | undefined;
		try {
			await applyMigrations(db);
			const bootstrap = new PgBoss({
				connectionString: container.url,
				schedule: false,
				supervise: false,
			});
			await bootstrap.start();
			await bootstrap.createQueue(PROCESS_EVENT_QUEUE);
			const activeId = await bootstrap.send(
				PROCESS_EVENT_QUEUE,
				{ marker: "unrelated active" },
				{ priority: 100 },
			);
			await bootstrap.fetch(PROCESS_EVENT_QUEUE);
			await bootstrap.send(PROCESS_EVENT_QUEUE, { marker: "unrelated queued" });
			const completedId = await bootstrap.send(PROCESS_EVENT_QUEUE, {
				marker: "unrelated completed",
			});
			if (!activeId || !completedId)
				throw new Error("general queue seed missing");
			await bootstrap.complete(
				PROCESS_EVENT_QUEUE,
				completedId,
				{ retained: true },
				{ includeQueued: true },
			);
			await pool.query(
				"UPDATE pgboss.job SET started_on = now() - interval '1 day', expire_seconds = 1 WHERE id = $1",
				[activeId],
			);
			await pool.query(
				"UPDATE pgboss.job SET completed_on = now() - interval '1 day', keep_until = now() - interval '1 day', deletion_seconds = 1 WHERE id = $1",
				[completedId],
			);
			await bootstrap.stop({ close: true, graceful: false });
			const generalBefore = await pool.query(
				"SELECT row_to_json(j) AS row FROM pgboss.job j WHERE name = $1 ORDER BY id",
				[PROCESS_EVENT_QUEUE],
			);
			const queuesBefore = await pool.query(
				"SELECT row_to_json(q) AS row FROM pgboss.queue q WHERE name = $1",
				[PROCESS_EVENT_QUEUE],
			);
			const schedulesBefore = await pool.query(
				"SELECT row_to_json(s) AS row FROM pgboss.schedule s ORDER BY name",
			);
			const logger = pino({ level: "silent" });
			producer = await gitCafeLifecycleServices.createGitCafeLifecycleBoss(
				container.url,
				logger,
			);
			const installation = gitCafeInstallationSchema.parse(
				await Bun.file(
					new URL(
						"../../../packages/forge-gitcafe/fixtures/gitcafe-installation.json",
						import.meta.url,
					),
				).json(),
			);
			const captured = gitCafeEventEnvelopeSchema.parse(
				await Bun.file(
					new URL(
						"../../../packages/forge-gitcafe/fixtures/gitcafe-installation-created.json",
						import.meta.url,
					),
				).json(),
			);
			const payload = {
				...captured,
				type: "installation.uninstalled",
				createdAt: new Date().toISOString(),
			};
			const body = JSON.stringify(payload);
			const receipt = gitCafeReceiptSchema.parse({
				format: "gitcafe-receipt@1",
				appId: GITCAFE_RECEIPT_APP_ID,
				payload,
				bodyBase64: Buffer.from(body).toString("base64"),
				bodySha256: createHash("sha256").update(body).digest("hex"),
				deliveryId: "negative-crash-uninstall",
				keyVersion: "local-test-1",
				signedAt: String(Math.floor(Date.now() / 1000)),
				requestId: generateId(),
			});
			const admitted = await gitCafeLifecycleServices.insertGitCafeReceipt(
				pool,
				producer,
				receipt,
			);
			const repoId = generateId();
			await db.insert(repos).values({
				id: repoId,
				forge: "gitcafe",
				externalId: generateId(),
				owner: installation.org,
				name: "scratch",
				fullName: `${installation.org}/scratch`,
				installationId: installation.id,
				armed: true,
			});
			await producer.stop({ close: true, graceful: false });
			/** The child leaves a fetched job active, matching a crash before receipt processing or acknowledgement. */
			const child = Bun.spawn(
				[
					process.execPath,
					"-e",
					`
			import { PgBoss } from ${JSON.stringify(import.meta.resolve("pg-boss"))};
			const boss = new PgBoss({ connectionString: process.argv[1], schedule: false, supervise: false, migrate: false, createSchema: false });
			await boss.start();
			const jobs = await boss.fetch(${JSON.stringify(GITCAFE_LIFECYCLE_QUEUE)});
			process.exit(jobs.length === 1 ? 0 : 1);
		`,
					container.url,
				],
				{ stdout: "ignore", stderr: "pipe" },
			);
			expect(await child.exited).toBe(0);
			expect(
				(
					await pool.query(
						"SELECT state FROM pgboss.job WHERE name = $1 ORDER BY created_on DESC, id DESC LIMIT 1",
						[GITCAFE_LIFECYCLE_QUEUE],
					)
				).rows[0]?.state,
			).toBe("active");
			await pool.query(
				"UPDATE pgboss.job SET started_on = now() - interval '1 hour', expire_seconds = 1, retry_delay = 0, retry_backoff = false WHERE name = $1",
				[GITCAFE_LIFECYCLE_QUEUE],
			);
			restarted = await createGitCafeConnectionBoss(container.url, logger);
			expect(await restarted.fetch(GITCAFE_LIFECYCLE_QUEUE)).toHaveLength(0);
			if (recoveryCase !== "single-crash") {
				for (let attempt = 0; attempt < 6; attempt++) {
					await pool.query(
						"UPDATE pgboss.queue SET monitor_on = now() - interval '1 hour' WHERE name = $1",
						[GITCAFE_LIFECYCLE_QUEUE],
					);
					await restarted.supervise(GITCAFE_LIFECYCLE_QUEUE);
					if (attempt < 5) {
						await pool.query(
							"UPDATE pgboss.job SET start_after = now() - interval '1 second' WHERE name = $1",
							[GITCAFE_LIFECYCLE_QUEUE],
						);
						expect(await restarted.fetch(GITCAFE_LIFECYCLE_QUEUE)).toHaveLength(
							1,
						);
						await pool.query(
							"UPDATE pgboss.job SET started_on = now() - interval '1 hour', expire_seconds = 1 WHERE name = $1",
							[GITCAFE_LIFECYCLE_QUEUE],
						);
					}
				}
				expect(
					(
						await pool.query(
							"SELECT state, retry_count FROM pgboss.job WHERE name = $1",
							[GITCAFE_LIFECYCLE_QUEUE],
						)
					).rows[0],
				).toMatchObject({ state: "failed", retry_count: 5 });
				expect(
					await gitCafeLifecycleServices.insertGitCafeReceipt(
						pool,
						restarted,
						receipt,
					),
				).toEqual({ inserted: false, receiptId: admitted.receiptId });
				expect(
					await gitCafeLifecycleServices.getGitCafeActionAuthority(
						db,
						installation.id,
					),
				).toEqual({ allowed: false });
				if (recoveryCase === "retained-receipt") {
					await pool.query("DELETE FROM pgboss.job WHERE name = $1", [
						GITCAFE_LIFECYCLE_QUEUE,
					]);
				} else {
					const recovered = await Promise.all([
						gitCafeLifecycleServices.recoverPendingGitCafeReceipts(
							db,
							restarted,
						),
						gitCafeLifecycleServices.recoverPendingGitCafeReceipts(
							db,
							restarted,
						),
					]);
					expect(recovered.reduce((sum, count) => sum + count, 0)).toBe(1);
				}
			}
			await registerGitCafeConnectionQueues(
				{ db, client: unavailableClient, lifecycleEnabled: true },
				restarted,
				logger,
			);
			let state: string | undefined;
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				state = (
					await pool.query(
						"SELECT state FROM pgboss.job WHERE name = $1 ORDER BY created_on DESC, id DESC LIMIT 1",
						[GITCAFE_LIFECYCLE_QUEUE],
					)
				).rows[0]?.state;
				if (state === "completed" || state === "failed") break;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(state).toBe("completed");
			expect(
				(
					await pool.query(
						"SELECT status FROM gitcafe_receipts WHERE id = $1",
						[admitted.receiptId],
					)
				).rows[0]?.status,
			).toBe("applied");
			expect(
				(
					await pool.query(
						"SELECT removed_at, armed FROM repos WHERE id = $1",
						[repoId],
					)
				).rows[0],
			).toMatchObject({ armed: false, removed_at: expect.any(Date) });
			const lifecycleBeforeReplay = await db
				.select()
				.from(gitCafeInstallationLifecycle);
			expect(lifecycleBeforeReplay[0]?.status).toBe("uninstalled");
			expect(
				await gitCafeLifecycleServices.processGitCafeReceipt(
					db,
					admitted.receiptId,
				),
			).toBe("applied");
			expect(await db.select().from(gitCafeInstallationLifecycle)).toEqual(
				lifecycleBeforeReplay,
			);
			expect(
				(
					await pool.query(
						"SELECT row_to_json(j) AS row FROM pgboss.job j WHERE name = $1 ORDER BY id",
						[PROCESS_EVENT_QUEUE],
					)
				).rows,
			).toEqual(generalBefore.rows);
			expect(
				(
					await pool.query(
						"SELECT row_to_json(q) AS row FROM pgboss.queue q WHERE name = $1",
						[PROCESS_EVENT_QUEUE],
					)
				).rows,
			).toEqual(queuesBefore.rows);
			expect(
				(
					await pool.query(
						"SELECT row_to_json(s) AS row FROM pgboss.schedule s ORDER BY name",
					)
				).rows,
			).toEqual(schedulesBefore.rows);
		} finally {
			await producer
				?.stop({ close: true, graceful: false })
				.catch(() => undefined);
			await restarted
				?.stop({ close: true, graceful: false })
				.catch(() => undefined);
			await pool.end();
			await container.stop();
		}
	}, 120_000);
}
