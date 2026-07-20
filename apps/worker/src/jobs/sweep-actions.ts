import type { Db } from "@tripwire/db";
import { runServices } from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import { reviewBody } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { toForgeAction } from "./pr-surface.ts";

/**
 * §5.12 surface sweeper (live-test surprise #3): actions are recorded FIRST and
 * executed after, so a forge-credentials outage leaves surface rows stuck at
 * `recorded` — the neutral check never reaches GitHub and the stale comment
 * stands. This job re-attempts stuck rows once credentials recover
 * (idempotency keys make retries safe), with two staleness guards so it never
 * regresses the PR surface:
 *
 * 1. COMMENT OWNERSHIP — the comment is per-PR, runs are per-SHA. Only the
 *    LATEST run for the change request may post its comment; an older run's
 *    recorded comment is superseded (its per-SHA check still posts — harmless).
 * 2. VERDICT MOVED ON — a completed run with a newer surface row of the same
 *    kind has already re-emitted; the older recorded row is superseded.
 *
 * Rows stuck past the give-up window are abandoned (superseded) with a loud log
 * rather than retried forever.
 */

const RETRY_AFTER_MS = 2 * 60_000;
const GIVE_UP_MS = 60 * 60_000;
const SURFACE_KINDS = new Set(["comment", "set-check"]);

export interface SweepDeps {
	db: Db;
	adapter: ForgeAdapter | null;
	logger: Logger;
}

export interface SweepOptions {
	/** Only sweep rows recorded before this instant (default: 2 min ago). */
	recordedBefore?: Date;
	/** Rows older than this are abandoned, not retried (default: 60 min ago). */
	giveUpBefore?: Date;
}

export interface SweepResult {
	swept: number;
	executed: number;
	superseded: number;
	abandoned: number;
}

/** Re-run rows still `queued` after this: worker never claimed (fail the card). */
const QUEUED_RUN_STUCK_MS = 3 * 60_000;

export async function sweepActions(
	deps: SweepDeps,
	options: SweepOptions = {},
): Promise<SweepResult> {
	const { db, adapter, logger } = deps;
	const now = Date.now();
	const recordedBefore =
		options.recordedBefore ?? new Date(now - RETRY_AFTER_MS);
	const giveUpBefore = options.giveUpBefore ?? new Date(now - GIVE_UP_MS);

	// Fail forever-queued re-runs so the activity card is honest when the
	// worker is not consuming rerun-change-request (or is lagging hard).
	const stuckQueued = await runServices.listStuckQueuedRuns(
		db,
		new Date(now - QUEUED_RUN_STUCK_MS),
	);
	for (const row of stuckQueued) {
		await runServices.failRun(db, row.id);
		logger.warn(
			{
				runId: row.id,
				repo: row.repoFullName,
				eventId: row.eventId,
			},
			"queued re-run never claimed — marked failed (worker not consuming?)",
		);
	}

	const stuck = await runServices.listStuckActions(db, recordedBefore);
	const result: SweepResult = {
		swept: stuck.length,
		executed: 0,
		superseded: 0,
		abandoned: 0,
	};

	for (const row of stuck) {
		if (row.kind === "comment" && row.subjectNumber !== null) {
			const latest = await runServices.getLatestRunIdForChangeRequest(
				db,
				row.repoFullName,
				row.subjectNumber,
			);
			if (latest && latest !== row.runId) {
				await runServices.markActionSuperseded(db, row.id);
				result.superseded++;
				logger.info(
					{ actionId: row.id, runId: row.runId, latestRunId: latest },
					"swept comment superseded — not the latest run for this change request",
				);
				continue;
			}
		}

		if (SURFACE_KINDS.has(row.kind) && row.runStatus === "completed") {
			const siblings = await runServices.listRunActions(db, row.runId);
			const supersededByNewer = siblings.some(
				(sibling) =>
					sibling.kind === row.kind &&
					sibling.recordedAt.getTime() > row.recordedAt.getTime(),
			);
			if (supersededByNewer) {
				await runServices.markActionSuperseded(db, row.id);
				result.superseded++;
				logger.info(
					{ actionId: row.id, runId: row.runId, kind: row.kind },
					"swept surface superseded — a newer verdict replaced it",
				);
				continue;
			}
		}

		if (row.recordedAt < giveUpBefore) {
			await runServices.markActionSuperseded(db, row.id);
			result.abandoned++;
			logger.error(
				{ actionId: row.id, kind: row.kind, recordedAt: row.recordedAt },
				"action abandoned — stuck past the give-up window, never executed",
			);
			continue;
		}

		if (!adapter) {
			logger.warn(
				{ actionId: row.id },
				"stuck action found but no forge credentials — leaving recorded",
			);
			continue;
		}
		if (row.subjectNumber === null) {
			continue;
		}

		try {
			const forgeAction = toForgeAction(
				{ kind: row.kind, payload: row.payload },
				row.repoFullName,
				row.subjectNumber,
				// Recovery path: a recorded block carries its own reason in payload;
				// the generic stamp is the fallback.
				reviewBody([]),
			);
			const executed = await adapter.execute(forgeAction);
			await runServices.markActionExecuted(db, row.id, executed.externalId);
			result.executed++;
			logger.info(
				{ actionId: row.id, kind: row.kind },
				"swept action executed after recovery",
			);
		} catch (error) {
			logger.warn(
				{ actionId: row.id, kind: row.kind, error: getErrorMessage(error) },
				"sweep re-attempt failed — row stays recorded",
			);
		}
	}

	if (result.swept > 0) {
		logger.info(result, "action sweep complete");
	}
	return result;
}
