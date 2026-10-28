import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	gitCafeReceiptJobSchema,
} from "@tripwire/contracts";
import { createDb, type Db, gitCafeLifecycleServices } from "@tripwire/db";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { z } from "zod";

export const gitCafeLifecycleWorkerEnvSchema = z.object({
	UNKEY_ENVIRONMENT_SLUG: z.literal("preview"),
	GITCAFE_APP_ID: z.literal(GITCAFE_RECEIPT_APP_ID),
	DATABASE_URL: z.string().min(1),
	PORT: z.coerce
		.number()
		.int()
		.min(1)
		.max(65535)
		.refine((port) => port !== 3000)
		.default(8181),
});

/** This mode consumes receipts only and has no forge credentials or general worker startup. */
export async function registerGitCafeLifecycleConsumer(
	db: Db,
	boss: PgBoss,
	logger: Logger,
): Promise<void> {
	await boss.work<unknown>(
		GITCAFE_LIFECYCLE_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsedJob = gitCafeReceiptJobSchema.safeParse(job.data);
				if (!parsedJob.success)
					throw new Error("Invalid GitCafe lifecycle job");
				const status = await gitCafeLifecycleServices.processGitCafeReceipt(
					db,
					parsedJob.data.receiptId,
				);
				logger.info(
					{
						jobId: job.id,
						requestId: parsedJob.data.requestId,
						receiptId: parsedJob.data.receiptId,
						status,
					},
					"GitCafe lifecycle receipt processed",
				);
			}
		},
	);
}

export async function startGitCafeLifecycleWorker(
	logger: Logger,
): Promise<void> {
	const parsed = gitCafeLifecycleWorkerEnvSchema.safeParse(process.env);
	if (!parsed.success)
		throw new Error("Invalid staging GitCafe lifecycle worker configuration");
	const env = parsed.data;
	const { db, pool } = createDb(env.DATABASE_URL);
	const boss = await gitCafeLifecycleServices.createGitCafeLifecycleBoss(
		env.DATABASE_URL,
		logger,
	);
	let healthy = true;
	boss.on("error", () => {
		healthy = false;
	});
	boss.on("stopped", () => {
		healthy = false;
	});
	await registerGitCafeLifecycleConsumer(db, boss, logger);
	const health = Bun.serve({
		port: env.PORT,
		fetch(request) {
			return new URL(request.url).pathname === "/healthz"
				? Response.json(
						{
							ok: healthy,
							mode: "gitcafe-lifecycle",
							queues: [GITCAFE_LIFECYCLE_QUEUE],
						},
						{ status: healthy ? 200 : 503 },
					)
				: new Response("not found", { status: 404 });
		},
	});
	const stop = async () => {
		healthy = false;
		health.stop(true);
		await boss.stop({ graceful: true, timeout: 30_000 });
		await pool.end();
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	logger.info(
		{
			mode: "gitcafe-lifecycle",
			healthPort: health.port,
			queues: [GITCAFE_LIFECYCLE_QUEUE],
		},
		"lifecycle worker up",
	);
}
