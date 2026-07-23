import type { RepoScopedEvent, UsageSource } from "@tripwire/contracts";
import type { AiReviewGenerate } from "@tripwire/core";
import type { BackfillRepoJob, Db } from "@tripwire/db";
import { eventServices, repoServices } from "@tripwire/db";
import { getErrorMessage } from "@tripwire/utils";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { WorkerReads } from "../context.ts";
import { runWorkflows } from "./run-workflows.ts";

/**
 * §4 arm-time backfill. When a repo is armed, replay its STORED change-request
 * events through the REAL engine so the dashboard has history the moment they
 * arm — real runs, `surface: false` so nothing comments/checks on historical
 * change requests (that would be a bot storm on old threads).
 *
 * Bounded on purpose: only the last N days, capped, and paced. The events are
 * stored, but each RuleContext still needs forge reads (diff, contributor), so
 * this is a burst of GitHub API calls on ONE repo — sequential + a delay keeps
 * it well under an installation's rate limit. A failed read degrades that one
 * run (the fail-closed floor already handles it), never the whole backfill.
 */
const BACKFILL_DAYS = 30;
const BACKFILL_CAP = 50;
const BETWEEN_EVENTS_MS = 400;

export interface BackfillDeps {
	db: Db;
	pool: Pool;
	reads: WorkerReads | null;
	makeGenerate: ((event: RepoScopedEvent) => AiReviewGenerate) | null;
	logger: Logger;
	/** Derived COGS source, threaded to runWorkflows for best-effort metering. */
	meterSource?: UsageSource;
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export async function backfillRepo(
	deps: BackfillDeps,
	job: BackfillRepoJob,
): Promise<void> {
	const { db, pool, reads, makeGenerate, logger } = deps;
	const repo = await repoServices.getRepoById(db, job.repoId);
	if (!repo || repo.removedAt || !repo.armed) {
		logger.info(
			{ repoId: job.repoId },
			"backfill skipped — repo gone or not armed",
		);
		return;
	}

	const events = await eventServices.listBackfillEvents(
		db,
		repo.fullName,
		BACKFILL_DAYS,
		BACKFILL_CAP,
	);
	await repoServices.setBackfillProgress(db, repo.id, {
		total: events.length,
		done: 0,
	});
	logger.info(
		{ repo: repo.fullName, total: events.length },
		"backfill started",
	);

	let done = 0;
	for (const event of events) {
		try {
			const result = await runWorkflows(
				{
					db,
					logger: logger.child({ eventId: event.id, backfill: true }),
					reads,
					makeGenerate,
					meterSource: deps.meterSource,
					surface: false,
				},
				event.normalized as RepoScopedEvent,
				event.id,
			);
			if (result.runId) {
				// Announce so the SSE feed fills in live as the backfill runs.
				await pool.query("SELECT pg_notify('runs', $1)", [event.id]);
			}
		} catch (error) {
			logger.warn(
				{ eventId: event.id, error: getErrorMessage(error) },
				"backfill event failed — skipped",
			);
		}
		done++;
		await repoServices.setBackfillProgress(db, repo.id, {
			total: events.length,
			done,
		});
		if (done < events.length) {
			await sleep(BETWEEN_EVENTS_MS);
		}
	}

	await repoServices.setBackfillProgress(db, repo.id, null);
	logger.info({ repo: repo.fullName, runs: done }, "backfill complete");
}
