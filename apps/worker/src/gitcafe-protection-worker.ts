import { captureException } from "@sentry/bun";
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
	type GitCafeEventSettlement,
	gitCafeBackfillRepoJobSchema,
	gitCafeProcessEventJobSchema,
	gitCafeRefreshCatalogsJobSchema,
	gitCafeRefreshSurfacesJobSchema,
	gitCafeResumeRunJobSchema,
	gitCafeScheduleTickJobSchema,
	normalizedEventSchema,
	rerunChangeRequestJobSchema,
	scheduleTickSlot,
} from "@tripwire/contracts";
import {
	createDb,
	createDirectPool,
	createGitCafeConnectionBoss,
	eventServices,
	gitCafeLifecycleServices,
	gitCafeOperationalServices,
	moderationServices,
	repoServices,
	runServices,
} from "@tripwire/db";
import { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";
import {
	generateId,
	isRetryableForgeStatus,
	withTimeout,
} from "@tripwire/utils";
import type { PgBoss, WorkHandler, WorkOptions } from "pg-boss";
import type { Logger } from "pino";
import type { z } from "zod";
import { createGenerate } from "./ai/generate.ts";
import {
	gitCafeConnectionWorkerEnvSchema,
	registerGitCafeConnectionConsumer,
} from "./gitcafe-connection-worker.ts";
import { registerGitCafeLifecycleConsumer } from "./gitcafe-lifecycle-consumer.ts";
import {
	createGitCafeRecoveryMonitor,
	type GitCafeRecoveryMonitor,
} from "./gitcafe-recovery-monitor.ts";
import { buildGitCafeRuntime, type GitCafeRuntime } from "./gitcafe-runtime.ts";
import { backfillRepo } from "./jobs/backfill-repo.ts";
import { emitGitCafeProcessingComment } from "./jobs/pr-surface.ts";
import { type ProcessEventDeps, processEvent } from "./jobs/process-event.ts";
import { refreshGitCafeCatalogs } from "./jobs/refresh-suggestions.ts";
import { refreshRepoSurfaces } from "./jobs/refresh-surfaces.ts";
import { rerunChangeRequest } from "./jobs/rerun.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { scheduleTick } from "./jobs/schedule-tick.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";
import { reportGitCafeStallToSentry } from "./report-gitcafe-stall.ts";

const PROTECTION_QUEUES = [
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RESUME_RUN_QUEUE,
	GITCAFE_RERUN_QUEUE,
	GITCAFE_REFRESH_SURFACES_QUEUE,
	GITCAFE_REFRESH_CATALOGS_QUEUE,
	GITCAFE_SCHEDULE_TICK_QUEUE,
	GITCAFE_BACKFILL_REPO_QUEUE,
];

type GitCafeProtectionEnv = z.infer<typeof gitCafeConnectionWorkerEnvSchema>;

export interface GitCafeProtectionRuntime {
	healthy(): boolean;
	queues: string[];
	stop(): Promise<void>;
}

export function resolveGitCafeProtectionEnv(
	environment: Record<string, string | undefined>,
): GitCafeProtectionEnv | null {
	if (environment.GITCAFE_WEBHOOK_RECEIPTS_ENABLED !== "true") return null;
	const parsed = gitCafeConnectionWorkerEnvSchema.safeParse(environment);
	if (!parsed.success)
		throw new Error("Invalid staging GitCafe protection worker configuration");
	return parsed.data;
}

/** Dedicated queues and scoped supervision keep every legacy forge backlog idle. */
export async function registerGitCafeProtectionQueues(
	deps: ProcessEventDeps,
	boss: PgBoss,
	prepareCheckRerequest: GitCafeRuntime["prepareCheckRerequest"],
	catalogRuntime: Pick<GitCafeRuntime, "getCatalogs">,
	monitor?: GitCafeRecoveryMonitor,
) {
	const workOptions = (queue: string): WorkOptions => ({
		batchSize: 1,
		localConcurrency: queue === GITCAFE_PROCESS_EVENT_QUEUE ? 4 : 1,
	});
	const work = (queue: string, handler: WorkHandler<unknown>) =>
		boss.work<unknown>(queue, workOptions(queue), async (jobs) => {
			try {
				return await handler(jobs);
			} catch (error) {
				monitor?.degrade();
				deps.logger.error(
					{
						err: error,
						event: "gitcafe.process.retrying",
						forge: "gitcafe",
						queue,
						jobId: jobs[0]?.id,
						reason: "queue-job-failed",
					},
					"GitCafe queue job failed",
				);
				const cause =
					error instanceof Error
						? error
						: new Error("GitCafe queue job failed", { cause: error });
				captureException(cause, {
					tags: { queue, forge: "gitcafe" },
				});
				throw cause;
			}
		});
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
	const initialRecovery = () =>
		gitCafeLifecycleServices.recoverGitCafeEvents(deps.db, boss);
	await (monitor
		? monitor.run("protection", initialRecovery)
		: initialRecovery());
	await work(GITCAFE_BACKFILL_REPO_QUEUE, async (jobs) => {
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
	});
	await work(GITCAFE_SCHEDULE_TICK_QUEUE, async (jobs) => {
		for (const job of jobs) {
			const parsed = gitCafeScheduleTickJobSchema.safeParse(job.data);
			if (!parsed.success) throw new Error("Invalid GitCafe schedule tick job");
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
	});
	await work(GITCAFE_REFRESH_CATALOGS_QUEUE, async (jobs) => {
		for (const job of jobs) {
			const parsed = gitCafeRefreshCatalogsJobSchema.safeParse(job.data);
			if (!parsed.success) throw new Error("Invalid GitCafe catalog job");
			const result = await refreshGitCafeCatalogs(
				{ db: deps.db, runtime: catalogRuntime, logger: deps.logger },
				parsed.data,
			);
			if (!result.ok) throw new Error("GitCafe catalog refresh unavailable");
		}
	});
	await work(GITCAFE_PROCESS_EVENT_QUEUE, async (jobs) => {
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
						forge: "gitcafe",
						queue: GITCAFE_PROCESS_EVENT_QUEUE,
						jobId: job.id,
						requestId: parsed.data.requestId,
						eventId: event.id,
					}),
				};
				eventDeps.logger.info(
					{
						event: "gitcafe.process.started",
						queueLatencyMs: Date.now() - event.receivedAt.getTime(),
					},
					"GitCafe processing started",
				);
				let settlement: GitCafeEventSettlement;
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
								isRetryableForgeStatus(prepared.status))
						)
							throw new Error("GitCafe check re-run preparation unavailable");
						settlement = {
							status: "skipped",
							reason:
								prepared.reason === "stale-event"
									? "stale-subject"
									: "unsupported-event",
						};
					} else {
						await rerunChangeRequest(eventDeps, prepared.value);
						const run = prepared.value.runId
							? await runServices.getRunById(deps.db, prepared.value.runId)
							: null;
						if (!run)
							throw new Error("GitCafe check rerun has no durable result");
						if (["queued", "running"].includes(run.status))
							throw new Error("GitCafe check rerun is still evaluating");
						settlement =
							run.verdict !== null &&
							["completed", "paused", "closed"].includes(run.status)
								? { status: "completed", runId: run.id }
								: {
										status: "skipped",
										reason: "rerun-not-evaluated",
										runId: run.id,
									};
					}
				} else {
					const result = await processEvent(eventDeps, parsed.data);
					if (result?.retry)
						throw new Error(`GitCafe event retry: ${result.reason}`);
					if (!result) throw new Error("GitCafe event has no settlement");
					settlement = result.settlement;
				}
				await gitCafeLifecycleServices.finishGitCafeEvent(
					deps.db,
					event.id,
					settlement,
				);
				eventDeps.logger.info(
					{
						event: "gitcafe.process.settled",
						totalLatencyMs: Date.now() - event.receivedAt.getTime(),
						...settlement,
					},
					"GitCafe processing settled",
				);
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
	});
	await work(GITCAFE_RESUME_RUN_QUEUE, async (jobs) => {
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
	});
	await work(GITCAFE_RERUN_QUEUE, async (jobs) => {
		for (const job of jobs) {
			const parsed = rerunChangeRequestJobSchema.safeParse(job.data);
			if (!parsed.success) throw new Error("Invalid GitCafe rerun job");
			if (parsed.data.forge === "gitcafe")
				await rerunChangeRequest(deps, parsed.data);
		}
	});
	await work(GITCAFE_REFRESH_SURFACES_QUEUE, async (jobs) => {
		for (const job of jobs) {
			const parsed = gitCafeRefreshSurfacesJobSchema.safeParse(job.data);
			if (!parsed.success) throw new Error("Invalid GitCafe refresh job");
			const repo = await repoServices.getRepoById(deps.db, parsed.data.repoId);
			if (repo?.forge === "gitcafe")
				await refreshRepoSurfaces(deps, parsed.data, job.id);
		}
	});
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
		const work = async () => {
			for (const name of PROTECTION_QUEUES) await boss.supervise(name);
			const recovered = await gitCafeLifecycleServices.recoverGitCafeEvents(
				deps.db,
				boss,
			);
			const stalled =
				await gitCafeOperationalServices.claimStalledGitCafeEvents(deps.db);
			for (const item of stalled) {
				const ageMs = Date.now() - item.receivedAt.getTime();
				deps.logger.error(
					{
						event: "gitcafe.process.stalled",
						eventId: item.id,
						deliveryId: item.deliveryId,
						rawKind: item.rawKind,
						ageMs,
						recoveryAttempts: item.recoveryAttempts,
					},
					"GitCafe event exceeded its processing deadline",
				);
				reportGitCafeStallToSentry({
					eventId: item.id,
					deliveryId: item.deliveryId,
					rawKind: item.rawKind,
					ageMs,
					recoveryAttempts: item.recoveryAttempts,
				});
				const event = await eventServices.getEventById(deps.db, item.id);
				const normalized = normalizedEventSchema.safeParse(event?.normalized);
				if (normalized.success)
					await emitGitCafeProcessingComment(
						{
							db: deps.db,
							adapter: deps.resolveForge("gitcafe")?.adapter ?? null,
							logger: deps.logger,
							appUrl: deps.appUrl,
						},
						normalized.data,
						item.id,
						"failed",
					);
			}
			await queueTick();
			await sweepActions(
				{
					db: deps.db,
					logger: deps.logger,
					appUrl: deps.appUrl,
					adapterFor: async (_repo, forge) =>
						deps.resolveForge(forge)?.adapter ?? null,
				},
				{
					forge: "gitcafe",
					recordedBefore: new Date(Date.now() - 15_000),
				},
			);
			return recovered;
		};
		try {
			await (monitor ? monitor.run("protection", work) : work());
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
	monitor?.signal.addEventListener("abort", () => clearInterval(recover), {
		once: true,
	});
	boss.once("stopped", () => clearInterval(recover));
	return PROTECTION_QUEUES;
}

export async function startGitCafeProtectionRuntime(
	logger: Logger,
	bossOverride?: PgBoss,
): Promise<GitCafeProtectionRuntime | null> {
	const env = resolveGitCafeProtectionEnv(process.env);
	if (!env) return null;
	const { db, pool } = createDb(env.DATABASE_URL);
	const directPool = createDirectPool();
	const actionPool = createDirectPool();
	const boss =
		bossOverride ??
		(await createGitCafeConnectionBoss(env.DATABASE_URL, logger));
	const ownsBoss = bossOverride === undefined;
	const runtimeId = generateId();
	const release = process.env.UNKEY_GIT_COMMIT_SHA ?? "unknown";
	logger = logger.child({
		service: "worker",
		forge: "gitcafe",
		release,
		mode: process.env.WORKER_MODE ?? "standard",
	});
	const expectedQueues = [
		...PROTECTION_QUEUES,
		GITCAFE_CONNECT_QUEUE,
		GITCAFE_LIFECYCLE_QUEUE,
	];
	const haveConsumers = () => {
		const workers = boss.getWipData();
		return expectedQueues.every((queue) =>
			workers.some((worker) => worker.name === queue),
		);
	};
	const heartbeat = () => {
		if (!haveConsumers()) throw new Error("GitCafe consumers are absent");
		return gitCafeOperationalServices.recordGitCafeRuntimeHeartbeat(db, {
			runtimeId,
			release,
		});
	};
	const health = createGitCafeRecoveryMonitor(logger, Date.now, heartbeat);
	boss.on("error", health.degrade);
	boss.on("stopped", health.stop);
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
			health,
		);
		await registerGitCafeLifecycleConsumer(
			db,
			boss,
			logger,
			health.degrade,
			true,
			health,
		);
		await boss.createQueue(GITCAFE_CONNECT_QUEUE);
		await registerGitCafeConnectionConsumer(
			{ db, client, lifecycleEnabled: true },
			boss,
			logger,
			health.degrade,
		);
		queues = [...protection, GITCAFE_CONNECT_QUEUE, GITCAFE_LIFECYCLE_QUEUE];
		health.registered();
		await withTimeout(heartbeat(), 4_000);
	} catch (error) {
		health.stop();
		boss.off("error", health.degrade);
		boss.off("stopped", health.stop);
		if (ownsBoss) await boss.stop({ graceful: false });
		else
			await Promise.allSettled(
				[
					...PROTECTION_QUEUES,
					GITCAFE_LIFECYCLE_QUEUE,
					GITCAFE_CONNECT_QUEUE,
				].map((queue) => boss.offWork(queue, { wait: false })),
			);
		await withTimeout(
			Promise.all([directPool.end(), actionPool.end(), pool.end()]),
			30_000,
		).catch(() => undefined);
		throw error;
	}
	const stop = async () => {
		health.stop();
		boss.off("error", health.degrade);
		boss.off("stopped", health.stop);
		if (ownsBoss) await boss.stop({ graceful: true, timeout: 30_000 });
		else
			await withTimeout(
				Promise.all(queues.map((queue) => boss.offWork(queue, { wait: true }))),
				30_000,
			).catch(() => undefined);
		await withTimeout(
			gitCafeOperationalServices.removeGitCafeRuntimeHeartbeat(db, runtimeId),
			4_000,
		).catch(() => undefined);
		await withTimeout(
			Promise.all([directPool.end(), actionPool.end(), pool.end()]),
			30_000,
		).catch(() => {
			logger.error(
				{ event: "gitcafe.shutdown.timeout", reason: "cleanup-unavailable" },
				"GitCafe runtime cleanup timed out",
			);
		});
	};
	logger.info(
		{
			mode: "gitcafe-protection",
			queues,
			receiptAdmissionEnabled: true,
			expectedAppId: env.GITCAFE_APP_ID,
			sentryConfigured: Boolean(process.env.SENTRY_DSN),
		},
		"GitCafe protection worker up",
	);
	return { healthy: () => health.healthy() && haveConsumers(), queues, stop };
}

export function runsGitCafeProtectionQueues(
	env: Record<string, string | undefined>,
): boolean {
	const branch = env.UNKEY_GIT_BRANCH;
	const canonicalBranch = env.GITCAFE_PROTECTION_BRANCH ?? "staging";
	return !(
		env.UNKEY_ENVIRONMENT_SLUG === "preview" &&
		branch &&
		branch !== canonicalBranch
	);
}

export async function startGitCafeProtectionWorker(
	logger: Logger,
): Promise<void> {
	const branch = process.env.UNKEY_GIT_BRANCH;
	const canonicalBranch = process.env.GITCAFE_PROTECTION_BRANCH ?? "staging";
	if (!runsGitCafeProtectionQueues(process.env)) {
		const port = gitCafeConnectionWorkerEnvSchema.parse(process.env).PORT;
		const server = Bun.serve({
			port,
			fetch(request) {
				return new URL(request.url).pathname === "/healthz"
					? Response.json({
							ok: true,
							live: true,
							ready: true,
							active: false,
							mode: "gitcafe-protection-standby",
							branch,
							canonicalBranch,
							queues: [],
						})
					: new Response("not found", { status: 404 });
			},
		});
		logger.info(
			{ branch, canonicalBranch },
			"GitCafe protection worker is standby on a non-canonical preview branch",
		);
		const stop = () => server.stop(true);
		process.once("SIGTERM", stop);
		process.once("SIGINT", stop);
		return;
	}
	const runtime = await startGitCafeProtectionRuntime(logger);
	if (!runtime)
		throw new Error("Invalid staging GitCafe protection worker configuration");
	const port = gitCafeConnectionWorkerEnvSchema.parse(process.env).PORT;
	const server = Bun.serve({
		port,
		fetch(request) {
			const healthy = runtime.healthy();
			return new URL(request.url).pathname === "/healthz"
				? Response.json(
						{
							ok: healthy,
							live: true,
							ready: healthy,
							mode: "gitcafe-protection",
							queues: runtime.queues,
						},
						{ status: healthy ? 200 : 503 },
					)
				: new Response("not found", { status: 404 });
		},
	});
	const stop = async () => {
		server.stop(true);
		await runtime.stop();
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
}
