import {
	GITCAFE_CONNECT_QUEUE,
	gitCafeConnectionJobSchema,
	gitCafeConnectionResultSchema,
} from "@tripwire/contracts";
import { createDb } from "@tripwire/db";
import { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";
import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { z } from "zod";
import {
	connectGitCafeInstallation,
	GITCAFE_STAGING_APP_ID,
} from "./jobs/gitcafe-connect.ts";

export const workerModeSchema = z.enum(["standard", "gitcafe-connect"]);
export type WorkerMode = z.infer<typeof workerModeSchema>;

export const gitCafeConnectionWorkerEnvSchema = z.object({
	UNKEY_ENVIRONMENT_SLUG: z.literal("preview"),
	GITCAFE_APP_ID: z.literal(GITCAFE_STAGING_APP_ID),
	GITCAFE_APP_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
	GITCAFE_APP_PRIVATE_KEY: z.string().min(1),
	DATABASE_URL: z.string().min(1),
	PORT: z.coerce
		.number()
		.int()
		.min(1)
		.max(65535)
		.refine((port) => port !== 3000)
		.default(8181),
});

/** No scheduler, maintenance, deployment fence, or general queue registration in staging connection mode. */
export async function startGitCafeConnectionWorker(
	logger: Logger,
): Promise<void> {
	const parsed = gitCafeConnectionWorkerEnvSchema.safeParse(process.env);
	if (!parsed.success)
		throw new Error("Invalid staging GitCafe connection worker configuration");
	const env = parsed.data;
	const { db } = createDb(env.DATABASE_URL);
	const boss = await createGitCafeConnectionBoss(env.DATABASE_URL, logger);
	const client = new GitCafeInstallationClient({
		credentials: {
			appId: env.GITCAFE_APP_ID,
			keyId: env.GITCAFE_APP_KEY_ID,
			privateKey: env.GITCAFE_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
		},
	});
	await boss.work<unknown>(
		GITCAFE_CONNECT_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			const job = jobs[0];
			if (!job) return;
			const authorization = gitCafeConnectionJobSchema.safeParse(job.data);
			const result = gitCafeConnectionResultSchema.parse(
				authorization.success
					? await connectGitCafeInstallation(
							{ db, client, fetch },
							authorization.data,
						)
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
		},
	);
	const health = Bun.serve({
		port: env.PORT,
		fetch(request) {
			return new URL(request.url).pathname === "/healthz"
				? Response.json({
						ok: true,
						mode: "gitcafe-connect",
						queues: [GITCAFE_CONNECT_QUEUE],
					})
				: new Response("not found", { status: 404 });
		},
	});
	logger.info(
		{
			healthPort: health.port,
			mode: "gitcafe-connect",
			queues: [GITCAFE_CONNECT_QUEUE],
		},
		"connection worker up",
	);
}

export async function createGitCafeConnectionBoss(
	databaseUrl: string,
	logger: Logger,
): Promise<PgBoss> {
	const boss = new PgBoss({
		connectionString: databaseUrl,
		schedule: false,
		supervise: false,
		migrate: false,
		createSchema: false,
	});
	boss.on("error", () => logger.error("GitCafe connection queue unavailable"));
	await boss.start();
	await boss.createQueue(GITCAFE_CONNECT_QUEUE);
	return boss;
}
