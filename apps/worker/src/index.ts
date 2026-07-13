import {
	createBoss,
	createDb,
	PROCESS_EVENT_QUEUE,
	type ProcessEventJob,
	RESUME_RUN_QUEUE,
	type ResumeRunJob,
	repoServices,
} from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import {
	checkAppCredentials,
	createGithubAdapter,
	GithubReads,
	InstallationTokenCache,
} from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import pino from "pino";
import { createGenerate } from "./ai/generate.ts";
import type { WorkerReads } from "./context.ts";
import { processEvent } from "./jobs/process-event.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { rollup } from "./jobs/rollup.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

/**
 * @tripwire/worker — pg-boss consumers, where I/O meets the pure core. Request
 * ids (the event id) thread through every log line.
 */
if (import.meta.main) {
	const logger = pino({ name: "worker" });
	const { db, pool } = createDb();
	const boss = await createBoss();

	const appId = process.env.GITHUB_APP_ID;
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll(
		"\\n",
		"\n",
	);
	let reads: WorkerReads | null = null;
	let adapter: ForgeAdapter | null = null;
	if (appId && privateKey) {
		const tokens = new InstallationTokenCache({ appId, privateKey });
		const tokenFor = async (repoFullName: string) => {
			const repo = await repoServices.getRepoByFullName(db, repoFullName);
			if (!repo?.installationId) {
				throw new Error(`no installation for ${repoFullName}`);
			}
			return await tokens.getToken(repo.installationId);
		};
		reads = new GithubReads({ tokenFor });
		adapter = createGithubAdapter({ tokenFor });
		/**
		 * Boot health (live-test surprise #3): validate the App credentials with
		 * one cheap authenticated call so a worker running on stale/broken env is
		 * loud at startup, not discovered per degraded run. Does not refuse to
		 * start — degraded runs still fail-closed to needs_review.
		 */
		try {
			const health = await checkAppCredentials({ appId, privateKey });
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
			"GITHUB_APP_* env missing — forge reads disabled, rules will skip",
		);
	}

	const openrouterKey = process.env.OPENROUTER_API_KEY;
	const defaultModel =
		process.env.AI_REVIEW_MODEL ?? "anthropic/claude-fable-5";
	const makeGenerate =
		openrouterKey && reads && adapter
			? (event: Parameters<typeof createGenerate>[0]["event"]) =>
					createGenerate({
						apiKey: openrouterKey,
						defaultModel,
						reads,
						readFile: (repo, path, ref) => adapter.readFile(repo, path, ref),
						event,
					})
			: null;
	logger.info(
		{ aiReview: makeGenerate ? "wired" : "disabled" },
		"ai-review credential check",
	);
	if (!makeGenerate) {
		logger.warn(
			"OPENROUTER_API_KEY or forge creds missing — ai-review will skip",
		);
	}

	await boss.work<ProcessEventJob>(PROCESS_EVENT_QUEUE, async (jobs) => {
		for (const job of jobs) {
			await processEvent(
				{
					db,
					pool,
					reads,
					adapter,
					makeGenerate,
					appUrl: process.env.APP_URL ?? "http://localhost:3000",
					logger: logger.child({ eventId: job.data.eventId }),
				},
				job.data,
			);
		}
	});

	await boss.work<ResumeRunJob>(RESUME_RUN_QUEUE, async (jobs) => {
		for (const job of jobs) {
			await resumeRun(
				{
					db,
					pool,
					reads,
					adapter,
					makeGenerate,
					appUrl: process.env.APP_URL ?? "http://localhost:3000",
					logger: logger.child({ itemId: job.data.itemId }),
				},
				job.data,
			);
		}
	});

	await boss.createQueue("rollup");
	await boss.schedule("rollup", "10 2 * * *", {}, {});
	await boss.work("rollup", async () => {
		await rollup({ db, logger });
	});

	/** §5.12 surface sweeper — re-attempt actions stuck at `recorded` (outage). */
	await boss.createQueue("sweep-actions");
	await boss.schedule("sweep-actions", "* * * * *", {}, {});
	await boss.work("sweep-actions", async () => {
		await sweepActions({ db, adapter, logger });
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
					github: adapter ? "live" : "disabled",
					aiReview: makeGenerate ? "wired" : "disabled",
				});
			}
			return new Response("not found", { status: 404 });
		},
	});

	logger.info(
		{ healthPort: health.port },
		"worker consuming process-event + resume-run + rollup + sweep-actions",
	);
}
