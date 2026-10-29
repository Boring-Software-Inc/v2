import {
	type Forge,
	GITCAFE_BACKFILL_REPO_QUEUE,
	GITCAFE_CONNECT_QUEUE,
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_REFRESH_CATALOGS_QUEUE,
	GITCAFE_REFRESH_SURFACES_QUEUE,
	GITCAFE_RERUN_QUEUE,
	GITCAFE_RESUME_RUN_QUEUE,
	GITCAFE_SCHEDULE_TICK_QUEUE,
	gitCafeBackfillRepoJobSchema,
	gitCafeProcessEventJobSchema,
	gitCafeRefreshCatalogsJobSchema,
	gitCafeRefreshSurfacesJobSchema,
	gitCafeResumeRunJobSchema,
	gitCafeScheduleTickJobSchema,
	rerunChangeRequestJobSchema,
	scheduleTickSlot,
} from "@tripwire/contracts";
import {
	createDb,
	createDirectPool,
	createGitCafeConnectionBoss,
	eventServices,
	gitCafeLifecycleServices,
	moderationServices,
	repoServices,
	runServices,
} from "@tripwire/db";
import { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";
import { generateId } from "@tripwire/utils";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { createGenerate } from "./ai/generate.ts";
import {
	gitCafeConnectionWorkerEnvSchema,
	registerGitCafeConnectionConsumer,
} from "./gitcafe-connection-worker.ts";
import {
	observeGitCafeQueueHealth,
	registerGitCafeLifecycleConsumer,
} from "./gitcafe-lifecycle-consumer.ts";
import { buildGitCafeRuntime, type GitCafeRuntime } from "./gitcafe-runtime.ts";
import { backfillRepo } from "./jobs/backfill-repo.ts";
import { type ProcessEventDeps, processEvent } from "./jobs/process-event.ts";
import { refreshGitCafeCatalogs } from "./jobs/refresh-suggestions.ts";
import { refreshRepoSurfaces } from "./jobs/refresh-surfaces.ts";
import { rerunChangeRequest } from "./jobs/rerun.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { scheduleTick } from "./jobs/schedule-tick.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

const PROTECTION_QUEUES = [
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RESUME_RUN_QUEUE,
	GITCAFE_RERUN_QUEUE,
	GITCAFE_REFRESH_SURFACES_QUEUE,
	GITCAFE_REFRESH_CATALOGS_QUEUE,
	GITCAFE_SCHEDULE_TICK_QUEUE,
	GITCAFE_BACKFILL_REPO_QUEUE,
];

/** Dedicated queues and scoped supervision keep every legacy forge backlog idle. */
export async function registerGitCafeProtectionQueues(
	deps: ProcessEventDeps,
	boss: PgBoss,
	prepareCheckRerequest: GitCafeRuntime["prepareCheckRerequest"],
	catalogRuntime: Pick<GitCafeRuntime, "getCatalogs">,
) {
	for (const name of PROTECTION_QUEUES) {
		await boss.createQueue(
			name,
			[GITCAFE_REFRESH_CATALOGS_QUEUE, GITCAFE_SCHEDULE_TICK_QUEUE].includes(
				name,
			)
				? { policy: "stately" }
				: undefined,
		);
		await boss.supervise(name);
	}
	await gitCafeLifecycleServices.recoverGitCafeEvents(deps.db, boss);
	await boss.work<unknown>(
		GITCAFE_BACKFILL_REPO_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = gitCafeBackfillRepoJobSchema.parse(job.data);
				const { requestId, ...binding } = parsed;
				if (
					!(await gitCafeLifecycleServices.matchesGitCafeRepositoryBinding(
						deps.db,
						binding,
					))
				)
					continue;
				await backfillRepo(
					{
						db: deps.db,
						pool: deps.pool,
						reads: deps.resolveForge("gitcafe")?.reads ?? null,
						makeGenerate: deps.makeGenerate,
						gitCafeHistoryBinding: binding,
						logger: deps.logger.child({ requestId, repoId: parsed.repoId }),
					},
					parsed,
				);
			}
		},
	);
	await boss.work<unknown>(
		GITCAFE_SCHEDULE_TICK_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = gitCafeScheduleTickJobSchema.safeParse(job.data);
				if (!parsed.success)
					throw new Error("Invalid GitCafe schedule tick job");
				const lock = await deps.pool.connect();
				try {
					await lock.query(
						"SELECT pg_advisory_lock(hashtext('gitcafe-schedule-tick'))",
					);
					const result = await scheduleTick({
						...deps,
						boss,
						forge: "gitcafe",
						requestId: parsed.data.requestId,
						logger: deps.logger.child({ requestId: parsed.data.requestId }),
					});
					if (result.errors)
						throw new Error("GitCafe scheduled discovery unavailable");
				} finally {
					try {
						await lock.query(
							"SELECT pg_advisory_unlock(hashtext('gitcafe-schedule-tick'))",
						);
					} finally {
						lock.release();
					}
				}
			}
		},
	);
	await boss.work<unknown>(
		GITCAFE_REFRESH_CATALOGS_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = gitCafeRefreshCatalogsJobSchema.safeParse(job.data);
				if (!parsed.success) throw new Error("Invalid GitCafe catalog job");
				const result = await refreshGitCafeCatalogs(
					{ db: deps.db, runtime: catalogRuntime, logger: deps.logger },
					parsed.data,
				);
				if (!result.ok) throw new Error("GitCafe catalog refresh unavailable");
			}
		},
	);
	await boss.work<unknown>(
		GITCAFE_PROCESS_EVENT_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = gitCafeProcessEventJobSchema.safeParse(job.data);
				if (!parsed.success) throw new Error("Invalid GitCafe process job");
				const event = await eventServices.getEventById(
					deps.db,
					parsed.data.eventId,
				);
				if (event?.forge !== "gitcafe" || event.processedAt) continue;
				const lock = await deps.pool.connect();
				try {
					await lock.query(
						"SELECT pg_advisory_lock(hashtext('gitcafe-process'), hashtext($1))",
						[event.id],
					);
					const current = await eventServices.getEventById(deps.db, event.id);
					if (current?.forge !== "gitcafe" || current.processedAt) continue;
					const eventDeps = {
						...deps,
						resumeNormalized: true,
						logger: deps.logger.child({
							requestId: parsed.data.requestId,
							eventId: event.id,
						}),
					};
					if (event.rawKind === "check.rerequested") {
						const prepared = await prepareCheckRerequest(event.id);
						if (!prepared.ok) {
							eventDeps.logger.warn(
								{ reason: prepared.reason, status: prepared.status },
								"GitCafe check re-run refused",
							);
							if (
								["network", "expired", "inactive"].includes(prepared.reason) ||
								(prepared.reason === "http" &&
									(prepared.status === 429 || (prepared.status ?? 0) >= 500))
							)
								throw new Error("GitCafe check re-run preparation unavailable");
						} else await rerunChangeRequest(eventDeps, prepared.value);
					} else {
						const result = await processEvent(eventDeps, parsed.data);
						if (result?.retry)
							throw new Error(`GitCafe event retry: ${result.reason}`);
					}
					await gitCafeLifecycleServices.finishGitCafeEvent(deps.db, event.id);
				} finally {
					try {
						await lock.query(
							"SELECT pg_advisory_unlock(hashtext('gitcafe-process'), hashtext($1))",
							[event.id],
						);
					} finally {
						lock.release();
					}
				}
			}
		},
	);
	await boss.work<unknown>(
		GITCAFE_RESUME_RUN_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = gitCafeResumeRunJobSchema.safeParse(job.data);
				if (!parsed.success) throw new Error("Invalid GitCafe resume job");
				const item = await moderationServices.getModerationItem(
					deps.db,
					parsed.data.itemId,
				);
				const run = item
					? await runServices.getRunById(deps.db, item.runId)
					: null;
				const event = run
					? await eventServices.getEventById(deps.db, run.eventId)
					: null;
				if (event?.forge === "gitcafe") await resumeRun(deps, parsed.data);
			}
		},
	);
	await boss.work<unknown>(
		GITCAFE_RERUN_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = rerunChangeRequestJobSchema.safeParse(job.data);
				if (!parsed.success) throw new Error("Invalid GitCafe rerun job");
				if (parsed.data.forge === "gitcafe")
					await rerunChangeRequest(deps, parsed.data);
			}
		},
	);
	await boss.work<unknown>(
		GITCAFE_REFRESH_SURFACES_QUEUE,
		{ batchSize: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const parsed = gitCafeRefreshSurfacesJobSchema.safeParse(job.data);
				if (!parsed.success) throw new Error("Invalid GitCafe refresh job");
				const repo = await repoServices.getRepoById(
					deps.db,
					parsed.data.repoId,
				);
				if (repo?.forge === "gitcafe")
					await refreshRepoSurfaces(deps, parsed.data, job.id);
			}
		},
	);
	let lastTickSlot: string | undefined;
	const queueTick = async () => {
		const slot = scheduleTickSlot(new Date()).toISOString();
		if (slot === lastTickSlot) return;
		const job = gitCafeScheduleTickJobSchema.parse({ requestId: generateId() });
		if (
			await boss.send(GITCAFE_SCHEDULE_TICK_QUEUE, job, {
				singletonKey: "tick",
				retryLimit: 10,
				retryDelay: 15,
				retryBackoff: true,
			})
		)
			lastTickSlot = slot;
	};
	await queueTick();
	let recovering = false;
	const recover = setInterval(async () => {
		if (recovering) return;
		recovering = true;
		try {
			for (const name of PROTECTION_QUEUES) await boss.supervise(name);
			await gitCafeLifecycleServices.recoverGitCafeEvents(deps.db, boss);
			await queueTick();
			await sweepActions(
				{
					db: deps.db,
					logger: deps.logger,
					appUrl: deps.appUrl,
					adapterFor: async (_repo, forge) =>
						deps.resolveForge(forge)?.adapter ?? null,
				},
				{ forge: "gitcafe" },
			);
		} catch {
			deps.logger.error(
				{ reason: "recovery-unavailable" },
				"GitCafe protection recovery unavailable",
			);
		} finally {
			recovering = false;
		}
	}, 30_000);
	recover.unref();
	boss.once("stopped", () => clearInterval(recover));
	return PROTECTION_QUEUES;
}

export async function startGitCafeProtectionWorker(
	logger: Logger,
): Promise<void> {
	const parsed = gitCafeConnectionWorkerEnvSchema.safeParse(process.env);
	if (
		!parsed.success ||
		parsed.data.GITCAFE_WEBHOOK_RECEIPTS_ENABLED !== "true"
	)
		throw new Error("Invalid staging GitCafe protection worker configuration");
	const env = parsed.data;
	const { db, pool } = createDb(env.DATABASE_URL);
	const directPool = createDirectPool();
	const actionPool = createDirectPool();
	const boss = await createGitCafeConnectionBoss(env.DATABASE_URL, logger);
	const health = observeGitCafeQueueHealth(boss);
	const credentials = {
		appId: env.GITCAFE_APP_ID,
		keyId: env.GITCAFE_APP_KEY_ID,
		privateKey: env.GITCAFE_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
	};
	const runtime = buildGitCafeRuntime(db, credentials, undefined, actionPool);
	const resolveForge = (forge: Forge) => (forge === "gitcafe" ? runtime : null);
	const inferenceKey =
		process.env.OPENROUTER_API_KEY_PROD ?? process.env.OPENROUTER_API_KEY;
	const makeGenerate: ProcessEventDeps["makeGenerate"] = inferenceKey
		? (event) => {
				const runtime = resolveForge(event.forge);
				return createGenerate({
					apiKey: inferenceKey,
					defaultModel:
						process.env.AI_REVIEW_MODEL ?? "anthropic/claude-fable-5",
					reads: runtime?.reads ?? null,
					readFile: (repo, path, oid) =>
						runtime?.adapter?.readFile(repo, path, oid) ??
						Promise.resolve(null),
					event,
				});
			}
		: null;
	let queues: string[];
	try {
		const client = new GitCafeInstallationClient({ credentials });
		const protection = await registerGitCafeProtectionQueues(
			{
				db,
				pool: directPool,
				logger,
				resolveForge,
				makeGenerate,
				appUrl: "https://staging.tripwire.sh",
			},
			boss,
			runtime.prepareCheckRerequest,
			runtime,
		);
		await registerGitCafeLifecycleConsumer(
			db,
			boss,
			logger,
			health.degrade,
			true,
		);
		await registerGitCafeConnectionConsumer(
			{ db, client, lifecycleEnabled: true },
			boss,
			logger,
			health.degrade,
		);
		queues = [...protection, GITCAFE_CONNECT_QUEUE, GITCAFE_LIFECYCLE_QUEUE];
	} catch (error) {
		await boss.stop({ graceful: false });
		await directPool.end();
		await actionPool.end();
		await pool.end();
		throw error;
	}
	const server = Bun.serve({
		port: env.PORT,
		fetch(request) {
			return new URL(request.url).pathname === "/healthz"
				? Response.json(
						{ ok: health.healthy, mode: "gitcafe-protection", queues },
						{ status: health.healthy ? 200 : 503 },
					)
				: new Response("not found", { status: 404 });
		},
	});
	const stop = async () => {
		health.degrade();
		server.stop(true);
		await boss.stop({ graceful: true, timeout: 30_000 });
		await directPool.end();
		await actionPool.end();
		await pool.end();
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	logger.info(
		{ mode: "gitcafe-protection", queues },
		"GitCafe protection worker up",
	);
}
