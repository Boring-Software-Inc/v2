import type { Forge } from "@tripwire/contracts";
import { DATABUDDY_WEBSITE_ID, deriveUsageSource } from "@tripwire/contracts";
import {
	aiProviderServices,
	BACKFILL_REPO_QUEUE,
	type BackfillRepoJob,
	createBoss,
	createDb,
	createDirectPool,
	PROCESS_EVENT_QUEUE,
	type ProcessEventJob,
	RECOVER_INSTALLATION_QUEUE,
	REFRESH_SURFACES_QUEUE,
	RERUN_QUEUE,
	RESUME_RUN_QUEUE,
	type RecoverInstallationJob,
	type RefreshSurfacesJob,
	type RerunChangeRequestJob,
	type ResumeRunJob,
	RULE_PREVIEW_QUEUE,
	type RulePreviewJob,
	SYNC_FLAG_OVERRIDES_QUEUE,
	SYNC_REPO_BRANCHES_QUEUE,
	SYNC_REPO_LABELS_QUEUE,
	SYNC_REPO_REVIEWERS_QUEUE,
	type SyncFlagOverridesJob,
	type SyncRepoBranchesJob,
	type SyncRepoLabelsJob,
	type SyncRepoReviewersJob,
	syncFlagOverridesOptions,
	syncRepoLabelsOptions,
	syncRepoReviewersOptions,
} from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import {
	checkAppCredentials,
	GithubInstallations,
} from "@tripwire/forge-github";
import { createDatabuddyApi, getErrorMessage } from "@tripwire/utils";
import type { WorkHandler } from "pg-boss";
import pino from "pino";
import { createGenerate } from "./ai/generate.ts";
import { captureJobFailures } from "./capture-job-failures.ts";
import { resolveDeploymentId, startFence } from "./fence.ts";
import { buildResolveForge } from "./forge-runtime.ts";
import {
	AUDIT_INSTALLATION_CLAIMS_QUEUE,
	auditInstallationClaims,
} from "./jobs/audit-installation-claims.ts";
import { backfillRepo } from "./jobs/backfill-repo.ts";
import {
	CHECK_AI_CREDITS_CRON,
	CHECK_AI_CREDITS_QUEUE,
	checkAiCredits,
} from "./jobs/check-ai-credits.ts";
import { deliverWebhooks } from "./jobs/deliver-webhook.ts";
import { economicsDigest } from "./jobs/economics-digest.ts";
import { economicsRollup } from "./jobs/economics-rollup.ts";
import { processEvent } from "./jobs/process-event.ts";
import { pullProviderCosts } from "./jobs/pull-provider-costs.ts";
import { recoverInstallation } from "./jobs/recover-installation.ts";
import { syncRepoBranches } from "./jobs/refresh-suggestions.ts";
import { refreshRepoSurfaces } from "./jobs/refresh-surfaces.ts";
import { rerunChangeRequest } from "./jobs/rerun.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { rollup } from "./jobs/rollup.ts";
import { refreshRulePreview } from "./jobs/rule-preview.ts";
import {
	SCHEDULE_TICK_CRON,
	SCHEDULE_TICK_QUEUE,
	scheduleTick,
} from "./jobs/schedule-tick.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";
import {
	SWEEP_FLAG_REMOVALS_CRON,
	SWEEP_FLAG_REMOVALS_QUEUE,
	sweepFlagRemovals,
	syncFlagOverridesJob,
} from "./jobs/sync-flag-overrides.ts";
import { syncRepoLabels } from "./jobs/sync-repo-labels.ts";
import { syncRepoReviewers } from "./jobs/sync-repo-reviewers.ts";
import * as metering from "./metering.ts";
import { installFailureReporter } from "./report-install-failure.ts";
import { reportAiCreditsToSentry } from "./report-unrunnable.ts";

/**
 * @tripwire/worker — pg-boss consumers, where I/O meets the pure core. Request
 * ids (the event id) thread through every log line.
 */
if (import.meta.main) {
	const logger = pino({
		name: "worker",
		// Outbound-delivery secrets never reach the logs — the url and signing
		// secret live only in the action row payload (server-side db), and the
		// delivery job logs only the failure class, never the destination.
		redact: [
			"*.url",
			"*.signingSecret",
			"payload.url",
			"payload.signingSecret",
			"delivery.url",
		],
	});
	const { db, pool } = createDb();
	/**
	 * The worker's `pool` is used ONLY for `pg_notify` (the SSE fan-out signal),
	 * so it goes through the direct/session endpoint — a NOTIFY delivered to the
	 * api's direct LISTEN must reach the same Postgres backend, and PlanetScale's
	 * transaction pooler would multiplex it away. Queries + pg-boss stay on the
	 * pooled `db`/`DATABASE_URL`.
	 */
	const directPool = createDirectPool();
	const boss = await createBoss(undefined, logger);

	const appId = process.env.GITHUB_APP_ID;
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll(
		"\\n",
		"\n",
	);
	const openGitBotId = process.env.OPEN_GIT_BOT_ID;
	const openGitKey = process.env.OPEN_GIT_BOT_PRIVATE_KEY?.replaceAll(
		"\\n",
		"\n",
	);
	// One resolver, chosen per event.forge downstream. Each forge needs its own
	// credentials; absent creds ⇒ that forge's events normalize and persist, but
	// nothing executes.
	const resolveForge = buildResolveForge({
		db,
		onCall: metering.addGithubCall,
		github: appId && privateKey ? { appId, privateKey } : null,
		opengit:
			openGitBotId && openGitKey
				? {
						botId: openGitBotId,
						privateKey: openGitKey,
						// Self-hosted open-git only; open-git.com is the default.
						apiBase: process.env.OPEN_GIT_URL,
					}
				: null,
	});
	// Backfill (arm-time) is GitHub-only for now; hand it the GitHub reads.
	const githubReads = resolveForge("github")?.reads ?? null;
	const githubAdapter = resolveForge("github")?.adapter ?? null;
	const githubInstallations =
		appId && privateKey
			? new GithubInstallations({ credentials: { appId, privateKey } })
			: null;
	const adapterFor = async (
		_repoFullName: string,
		forge: Forge,
	): Promise<ForgeAdapter | null> => resolveForge(forge)?.adapter ?? null;

	const selfLogins = new Set<string>();
	if (appId && privateKey) {
		/**
		 * Boot health (live-test surprise #3): validate the App credentials with
		 * one cheap authenticated call so a worker running on stale/broken env is
		 * loud at startup, not discovered per degraded run. Does not refuse to
		 * start — degraded runs still fail-closed to needs_review.
		 */
		try {
			const health = await checkAppCredentials({ appId, privateKey });
			selfLogins.add(`${health.slug}[bot]`.toLowerCase());
			logger.info(
				{ app: health.slug },
				"github app credentials OK — reads + actions live",
			);
		} catch (error) {
			logger.error(
				{ error: getErrorMessage(error) },
				"GITHUB APP CREDENTIALS INVALID AT BOOT — every run will degrade to needs_review until fixed",
			);
		}
	} else {
		logger.warn(
			"GITHUB_APP_* env missing — github reads disabled, rules will skip",
		);
	}

	// Key split (economics-surface-contracts.md): the worker holds the PROD
	// inference key. OPENROUTER_API_KEY stays as a back-compat fallback so a
	// deploy without the new var keeps working. The eval harness uses its own
	// key; the analytics pull uses a third, read-only management key.
	const openrouterKey =
		process.env.OPENROUTER_API_KEY_PROD ?? process.env.OPENROUTER_API_KEY;
	// Source is derived, never guessed: the prod key under NODE_ENV=production is
	// 'prod' COGS; the same key locally is 'dev'; underivable is 'dev'.
	const meterSource = deriveUsageSource({
		keyKind: openrouterKey ? "prod" : null,
		isProdEnv: process.env.NODE_ENV === "production",
	});
	const defaultModel =
		process.env.AI_REVIEW_MODEL ?? "anthropic/claude-fable-5";
	const makeGenerate = openrouterKey
		? (event: Parameters<typeof createGenerate>[0]["event"]) => {
				// ai-review reads through the EVENT's forge runtime; a null runtime
				// (creds absent) degrades via null reads, same as before.
				const runtime = resolveForge(event.forge);
				return createGenerate({
					apiKey: openrouterKey,
					defaultModel,
					reads: runtime?.reads ?? null,
					readFile: (repo, path, ref) =>
						runtime?.adapter?.readFile(repo, path, ref) ??
						Promise.resolve(null),
					event,
					countBytesOut: metering.addOpenRouterBytesOut,
				});
			}
		: null;
	logger.info(
		{ aiReview: makeGenerate ? "wired" : "disabled", meterSource },
		"ai-review credential check",
	);
	if (!makeGenerate) {
		logger.warn(
			"OPENROUTER_API_KEY or forge creds missing — ai-review will skip",
		);
	}

	const databuddyKey = process.env.DATABUDDY_API_KEY;
	const databuddyApi = databuddyKey
		? createDatabuddyApi({
				apiKey: databuddyKey,
				websiteId: DATABUDDY_WEBSITE_ID,
				baseUrl: process.env.DATABUDDY_API_URL,
			})
		: null;
	if (!databuddyApi) {
		logger.warn("DATABUDDY_API_KEY missing: flag overrides will not sync");
	}

	const enqueueLabelSync = async (repoId: string): Promise<void> => {
		await boss.send(
			SYNC_REPO_LABELS_QUEUE,
			{ repoId },
			syncRepoLabelsOptions(repoId),
		);
	};

	const enqueueReviewerSync = async (repoId: string): Promise<void> => {
		await boss.send(
			SYNC_REPO_REVIEWERS_QUEUE,
			{ repoId },
			syncRepoReviewersOptions(repoId),
		);
	};

	const working = new Set<string>();
	const work = async <T>(name: string, handler: WorkHandler<T>) => {
		if (working.has(name)) {
			return;
		}
		await boss.work<T>(name, captureJobFailures(name, handler));
		working.add(name);
	};

	const consumeQueues = async (): Promise<void> => {
		await work<ProcessEventJob>(PROCESS_EVENT_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await processEvent(
					{
						db,
						pool: directPool,
						resolveForge,
						makeGenerate,
						meterSource,
						appUrl: process.env.APP_URL ?? "http://localhost:3000",
						logger: logger.child({ eventId: job.data.eventId }),
						enqueueReviewerSync,
						enqueueLabelSync,
						selfLogins,
					},
					job.data,
				);
			}
		});

		await work<ResumeRunJob>(RESUME_RUN_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await resumeRun(
					{
						db,
						pool: directPool,
						resolveForge,
						makeGenerate,
						meterSource,
						appUrl: process.env.APP_URL ?? "http://localhost:3000",
						logger: logger.child({ itemId: job.data.itemId }),
					},
					job.data,
				);
			}
		});

		await work<RerunChangeRequestJob>(RERUN_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await rerunChangeRequest(
					{
						db,
						pool: directPool,
						resolveForge,
						makeGenerate,
						meterSource,
						appUrl: process.env.APP_URL ?? "http://localhost:3000",
						logger: logger.child({
							rerun: `${job.data.repoFullName}#${job.data.number}`,
						}),
					},
					job.data,
				);
			}
		});

		await work<BackfillRepoJob>(BACKFILL_REPO_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await backfillRepo(
					{
						db,
						pool: directPool,
						reads: githubReads,
						makeGenerate,
						meterSource,
						logger: logger.child({ repoId: job.data.repoId, backfill: true }),
					},
					job.data,
				);
			}
		});

		await work<SyncRepoReviewersJob>(
			SYNC_REPO_REVIEWERS_QUEUE,
			async (jobs) => {
				for (const job of jobs) {
					await syncRepoReviewers(
						{
							db,
							http: resolveForge("github")?.signalHttp ?? null,
							logger: logger.child({ repoId: job.data.repoId }),
						},
						job.data,
					);
				}
			},
		);

		await work<SyncRepoLabelsJob>(SYNC_REPO_LABELS_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await syncRepoLabels(
					{
						db,
						http: resolveForge("github")?.signalHttp ?? null,
						logger: logger.child({ repoId: job.data.repoId }),
					},
					job.data,
				);
			}
		});

		await work<SyncRepoBranchesJob>(SYNC_REPO_BRANCHES_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await syncRepoBranches(
					{
						db,
						http: resolveForge("github")?.signalHttp ?? null,
						logger: logger.child({ repoId: job.data.repoId }),
					},
					job.data,
				);
			}
		});

		await work<RulePreviewJob>(RULE_PREVIEW_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await refreshRulePreview(
					{ db, logger: logger.child({ repoId: job.data.repoId }) },
					job.data,
				);
			}
		});

		await work<SyncFlagOverridesJob>(
			SYNC_FLAG_OVERRIDES_QUEUE,
			async (jobs) => {
				for (const job of jobs) {
					await syncFlagOverridesJob(
						{
							db,
							api: databuddyApi,
							logger: logger.child({ flagKey: job.data.flagKey }),
						},
						job.data,
					);
				}
			},
		);

		await work<RecoverInstallationJob>(
			RECOVER_INSTALLATION_QUEUE,
			async (jobs) => {
				for (const job of jobs) {
					const jobLogger = logger.child({
						installationId: job.data.installationId,
						recovery: true,
					});
					await recoverInstallation(
						{
							db,
							github: githubInstallations,
							logger: jobLogger,
							report: installFailureReporter(jobLogger),
						},
						job.data,
					);
				}
			},
		);

		await work<RefreshSurfacesJob>(REFRESH_SURFACES_QUEUE, async (jobs) => {
			for (const job of jobs) {
				await refreshRepoSurfaces(
					{
						db,
						resolveForge,
						appUrl: process.env.APP_URL ?? "http://localhost:3000",
						logger: logger.child({ refresh: job.data.repoId }),
					},
					job.data,
					job.id,
				);
			}
		});

		await boss.createQueue("rollup");
		await boss.schedule("rollup", "10 2 * * *", {}, {});
		await work("rollup", async () => {
			await rollup({ db, logger });
		});

		await boss.createQueue(AUDIT_INSTALLATION_CLAIMS_QUEUE);
		await boss.schedule(AUDIT_INSTALLATION_CLAIMS_QUEUE, "50 2 * * *", {}, {});
		await work(AUDIT_INSTALLATION_CLAIMS_QUEUE, async () => {
			await auditInstallationClaims({
				db,
				logger: logger.child({ audit: AUDIT_INSTALLATION_CLAIMS_QUEUE }),
			});
		});

		await boss.createQueue(SWEEP_FLAG_REMOVALS_QUEUE);
		await boss.schedule(
			SWEEP_FLAG_REMOVALS_QUEUE,
			SWEEP_FLAG_REMOVALS_CRON,
			{},
			{},
		);
		await work(SWEEP_FLAG_REMOVALS_QUEUE, async () => {
			await sweepFlagRemovals({
				db,
				enqueue: async (flagKey) => {
					await boss.send(
						SYNC_FLAG_OVERRIDES_QUEUE,
						{ flagKey },
						syncFlagOverridesOptions(flagKey),
					);
				},
				logger,
			});
		});

		/** §5.12 surface sweeper — re-attempt actions stuck at `recorded` (outage). */
		await boss.createQueue("sweep-actions");
		await boss.schedule("sweep-actions", "* * * * *", {}, {});
		await work("sweep-actions", async () => {
			await sweepActions({
				db,
				adapterFor,
				logger,
				appUrl: process.env.APP_URL ?? "http://localhost:3000",
			});
		});

		await boss.createQueue(SCHEDULE_TICK_QUEUE);
		await boss.schedule(SCHEDULE_TICK_QUEUE, SCHEDULE_TICK_CRON, {}, {});
		await work(SCHEDULE_TICK_QUEUE, async () => {
			await scheduleTick({
				db,
				pool,
				boss,
				resolveForge,
				logger: logger.child({ job: SCHEDULE_TICK_QUEUE }),
			});
		});

		/** Outbound delivery — POST webhook/discord rows through the SSRF guard;
		 * the poll IS the retry (recorded rows re-attempt each tick). */
		await boss.createQueue("deliver-webhook");
		await boss.schedule("deliver-webhook", "* * * * *", {}, {});
		await work("deliver-webhook", async () => {
			await deliverWebhooks({ db, logger });
		});

		await boss.createQueue(CHECK_AI_CREDITS_QUEUE);
		await boss.schedule(CHECK_AI_CREDITS_QUEUE, CHECK_AI_CREDITS_CRON, {}, {});
		await work(CHECK_AI_CREDITS_QUEUE, async () => {
			await checkAiCredits(
				{
					logger: logger.child({ job: CHECK_AI_CREDITS_QUEUE }),
					fetch,
					record: (state) => aiProviderServices.recordAiCredits(db, state),
					report: reportAiCreditsToSentry,
				},
				{
					inferenceKey: openrouterKey ?? null,
					managementKey: process.env.OPENROUTER_MANAGEMENT_KEY ?? null,
				},
			);
		});
		await boss.send(CHECK_AI_CREDITS_QUEUE, {});

		/** Economics: pull provider invoices into provider_costs_daily. 01:40 UTC,
		 * ahead of the 02:20 economics rollup. Best-effort per provider. */
		await boss.createQueue("pull-provider-costs");
		await boss.schedule("pull-provider-costs", "40 1 * * *", {}, {});
		await work("pull-provider-costs", async () => {
			await pullProviderCosts({ db, logger });
		});

		/** Economics: roll the prior UTC day into economics_daily with drift, credit
		 * balance, and reconciliation. 02:20 UTC, after the pull. */
		await boss.createQueue("economics-rollup");
		await boss.schedule("economics-rollup", "20 2 * * *", {}, {});
		await work("economics-rollup", async () => {
			await economicsRollup({ db, logger });
		});

		/** Economics: post the daily digest + alerts to Discord, plus the monthly
		 * report on the 1st. 02:30 UTC, after the rollup. */
		await boss.createQueue("economics-digest");
		await boss.schedule("economics-digest", "30 2 * * *", {}, {});
		await work("economics-digest", async () => {
			await economicsDigest({ db, logger });
		});
	};

	const pauseQueues = async (): Promise<void> => {
		for (const name of working) {
			await boss.offWork(name, { wait: false });
			working.delete(name);
		}
	};

	const fence = await startFence({
		db,
		deploymentId: resolveDeploymentId(),
		logger,
		consume: consumeQueues,
		pause: pauseQueues,
	});

	/**
	 * Liveness surface. The worker has no other HTTP endpoint; Railway's
	 * healthcheck hits `/healthz` so a crashed or hung consumer is visible
	 * instead of silently draining the queue. Binds `PORT` (Railway injects it)
	 * with a local fallback. `github` reflects the boot credential check —
	 * `disabled` means forge reads are off (rules skip), which is a real
	 * degradation worth surfacing on the health page.
	 */
	const healthPort = Number(
		process.env.PORT ?? process.env.WORKER_HEALTH_PORT ?? 8181,
	);
	const health = Bun.serve({
		port: healthPort,
		fetch(req) {
			const { pathname } = new URL(req.url);
			if (pathname === "/healthz") {
				return Response.json({
					ok: true,
					github: githubAdapter ? "live" : "disabled",
					aiReview: makeGenerate ? "wired" : "disabled",
					leader: fence.leader(),
				});
			}
			return new Response("not found", { status: 404 });
		},
	});

	logger.info(
		{
			healthPort: health.port,
			leader: fence.leader(),
			queues: [
				PROCESS_EVENT_QUEUE,
				RESUME_RUN_QUEUE,
				RERUN_QUEUE,
				BACKFILL_REPO_QUEUE,
				SYNC_REPO_REVIEWERS_QUEUE,
				SYNC_REPO_LABELS_QUEUE,
				SYNC_REPO_BRANCHES_QUEUE,
				RULE_PREVIEW_QUEUE,
				SYNC_FLAG_OVERRIDES_QUEUE,
				SWEEP_FLAG_REMOVALS_QUEUE,
				REFRESH_SURFACES_QUEUE,
				RECOVER_INSTALLATION_QUEUE,
				"rollup",
				AUDIT_INSTALLATION_CLAIMS_QUEUE,
				"sweep-actions",
				SCHEDULE_TICK_QUEUE,
				"deliver-webhook",
				"pull-provider-costs",
				"economics-rollup",
				"economics-digest",
			],
		},
		"worker up",
	);
}
