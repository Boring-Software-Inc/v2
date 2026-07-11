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
	createGithubAdapter,
	GithubReads,
	InstallationTokenCache,
} from "@tripwire/forge-github";
import pino from "pino";
import { createGenerate } from "./ai/generate.ts";
import type { WorkerReads } from "./context.ts";
import { processEvent } from "./jobs/process-event.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { rollup } from "./jobs/rollup.ts";

/**
 * @tripwire/worker — pg-boss consumers, where I/O meets the pure core. Request
 * ids (the event id) thread through every log line.
 */
if (import.meta.main) {
	const logger = pino({ name: "worker" });
	const { db, pool } = createDb();
	const boss = await createBoss();

	const appId = process.env.GITHUB_APP_ID;
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
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

	logger.info("worker consuming process-event + resume-run + rollup");
}
