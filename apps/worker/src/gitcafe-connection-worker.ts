import {
	GITCAFE_CONNECT_QUEUE,
	GITCAFE_LIFECYCLE_QUEUE,
	gitCafeConnectionJobSchema,
	gitCafeConnectionResultSchema,
} from "@tripwire/contracts";
import { createDb, createGitCafeConnectionBoss } from "@tripwire/db";
import { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { z } from "zod";
import {
	observeGitCafeQueueHealth,
	registerGitCafeLifecycleConsumer,
} from "./gitcafe-lifecycle-consumer.ts";
import {
	connectGitCafeInstallation,
	GITCAFE_STAGING_APP_ID,
	type GitCafeConnectionDeps,
} from "./jobs/gitcafe-connect.ts";

export const workerModeSchema = z.enum([
	"standard",
	"gitcafe-connect",
	"gitcafe-lifecycle",
	"gitcafe-protection",
]);
export type WorkerMode = z.infer<typeof workerModeSchema>;

export const gitCafeConnectionWorkerEnvSchema = z.object({
	UNKEY_ENVIRONMENT_SLUG: z.literal("preview"),
	GITCAFE_APP_ID: z.literal(GITCAFE_STAGING_APP_ID),
	GITCAFE_APP_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
	GITCAFE_APP_PRIVATE_KEY: z.string().min(1),
	DATABASE_URL: z.string().min(1),
	GITCAFE_WEBHOOK_RECEIPTS_ENABLED: z.enum(["true", "false"]).default("false"),
	PORT: z.coerce
		.number()
		.int()
		.min(1)
		.max(65535)
		.refine((port) => port !== 3000)
		.default(8181),
});

export async function registerGitCafeConnectionConsumer(
	deps: GitCafeConnectionDeps,
	boss: PgBoss,
	logger: Logger,
	onError: () => void = () => {},
): Promise<void> {
	await boss.work<unknown>(
		GITCAFE_CONNECT_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			try {
				const job = jobs[0];
				if (!job) return;
				const authorization = gitCafeConnectionJobSchema.safeParse(job.data);
				const result = gitCafeConnectionResultSchema.parse(
					authorization.success
						? await connectGitCafeInstallation(deps, authorization.data)
						: { ok: false, reason: "invalid-job" },
				);
				logger.info(
					{
						jobId: job.id,
						requestId: authorization.success
							? authorization.data.requestId
							: undefined,
						ok: result.ok,
						...(result.ok
							? { repoCount: result.repoCount }
							: { reason: result.reason }),
					},
					"GitCafe connection finished",
				);
				return result;
			} catch (error) {
				onError();
				throw error;
			}
		},
	);
}

export async function registerGitCafeConnectionQueues(
	deps: GitCafeConnectionDeps,
	boss: PgBoss,
	logger: Logger,
) {
	const queues = [GITCAFE_CONNECT_QUEUE];
	const health = observeGitCafeQueueHealth(boss);
	if (deps.lifecycleEnabled) {
		await registerGitCafeLifecycleConsumer(
			deps.db,
			boss,
			logger,
			health.degrade,
		);
		queues.push(GITCAFE_LIFECYCLE_QUEUE);
	}
	await registerGitCafeConnectionConsumer(deps, boss, logger, health.degrade);
	return { queues, health };
}

/** General backlog stays idle when lifecycle receipt recovery shares the connection worker. */
export async function startGitCafeConnectionWorker(
	logger: Logger,
): Promise<void> {
	const parsed = gitCafeConnectionWorkerEnvSchema.safeParse(process.env);
	if (!parsed.success)
		throw new Error("Invalid staging GitCafe connection worker configuration");
	const env = parsed.data;
	const { db, pool } = createDb(env.DATABASE_URL);
	const boss = await createGitCafeConnectionBoss(env.DATABASE_URL, logger);
	const lifecycleEnabled = env.GITCAFE_WEBHOOK_RECEIPTS_ENABLED === "true";
	const client = new GitCafeInstallationClient({
		credentials: {
			appId: env.GITCAFE_APP_ID,
			keyId: env.GITCAFE_APP_KEY_ID,
			privateKey: env.GITCAFE_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
		},
	});
	let registration: Awaited<ReturnType<typeof registerGitCafeConnectionQueues>>;
	try {
		registration = await registerGitCafeConnectionQueues(
			{ db, client, lifecycleEnabled },
			boss,
			logger,
		);
	} catch (error) {
		await boss.stop({ graceful: false });
		await pool.end();
		throw error;
	}
	const { queues, health: queueHealth } = registration;
	const health = Bun.serve({
		port: env.PORT,
		fetch(request) {
			return new URL(request.url).pathname === "/healthz"
				? Response.json(
						{
							ok: queueHealth.healthy,
							mode: "gitcafe-connect",
							queues,
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
			healthPort: health.port,
			mode: "gitcafe-connect",
			queues,
		},
		"connection worker up",
	);
}
