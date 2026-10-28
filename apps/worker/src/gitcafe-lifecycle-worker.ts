import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
} from "@tripwire/contracts";
import { createDb, gitCafeLifecycleServices } from "@tripwire/db";
import type { Logger } from "pino";
import { z } from "zod";
import {
	observeGitCafeQueueHealth,
	registerGitCafeLifecycleConsumer,
} from "./gitcafe-lifecycle-consumer.ts";

export const gitCafeLifecycleWorkerEnvSchema = z.object({
	UNKEY_ENVIRONMENT_SLUG: z.literal("preview"),
	GITCAFE_APP_ID: z.literal(GITCAFE_RECEIPT_APP_ID),
	DATABASE_URL: z.string().min(1),
	GITCAFE_WEBHOOK_RECEIPTS_ENABLED: z.literal("true"),
	PORT: z.coerce
		.number()
		.int()
		.min(1)
		.max(65535)
		.refine((port) => port !== 3000)
		.default(8181),
});

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
	const queueHealth = observeGitCafeQueueHealth(boss);
	try {
		await registerGitCafeLifecycleConsumer(
			db,
			boss,
			logger,
			queueHealth.degrade,
		);
	} catch (error) {
		await boss.stop({ graceful: false });
		await pool.end();
		throw error;
	}
	const health = Bun.serve({
		port: env.PORT,
		fetch(request) {
			return new URL(request.url).pathname === "/healthz"
				? Response.json(
						{
							ok: queueHealth.healthy,
							mode: "gitcafe-lifecycle",
							queues: [GITCAFE_LIFECYCLE_QUEUE],
						},
						{ status: queueHealth.healthy ? 200 : 503 },
					)
				: new Response("not found", { status: 404 });
		},
	});
	const stop = async () => {
		queueHealth.degrade();
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
