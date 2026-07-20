import type { RepoScopedEvent } from "@tripwire/contracts";
import { normalizedEventSchema } from "@tripwire/contracts";
import type { RerunChangeRequestJob } from "@tripwire/db";
import { eventServices } from "@tripwire/db";
import { normalizeWebhook } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import { emitPendingCheck, emitPrSurface } from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";
import { runWorkflows } from "./run-workflows.ts";

/**
 * Manual re-run (org-admin action): evaluate the change request again under
 * the CURRENT enabled workflow, as a NEW run, delivered through the normal
 * amendment path. A second caller of the one evaluation path — this handler
 * is process-event's shape minus ingest: load the PR's latest evaluatable
 * event, re-normalize it (replay technique: current normalizer over the
 * stored raw, stored normalized as fallback), refresh the head SHA, then the
 * same runWorkflows + emitPrSurface the webhook path calls. The original run
 * is never touched; comment upsert and check update are already
 * amendment-shaped (previousVerdict from run history drives supersession).
 */
export async function rerunChangeRequest(
	deps: ProcessEventDeps,
	job: RerunChangeRequestJob,
): Promise<void> {
	const { db, pool, logger } = deps;
	const row = await eventServices.getLatestChangeRequestEvent(
		db,
		job.repoFullName,
		job.number,
	);
	if (!row) {
		logger.warn(
			{ repo: job.repoFullName, number: job.number },
			"re-run requested but no evaluatable event exists",
		);
		return;
	}

	let event: RepoScopedEvent;
	try {
		const renormalized = normalizeWebhook(
			{
				deliveryId: row.deliveryId,
				eventName: row.rawKind,
				body: JSON.stringify(row.raw),
				signature: null,
			},
			row.receivedAt.toISOString(),
		);
		if (!renormalized || !("changeRequest" in renormalized)) {
			throw new Error("stored event no longer normalizes to a change request");
		}
		event = renormalized;
	} catch (error) {
		// Current normalizer refused the stored raw — fall back to the stored
		// normalized form (validated at write time), like verdict replay does.
		const stored = normalizedEventSchema.safeParse(row.normalized);
		if (!stored.success || !("changeRequest" in stored.data)) {
			logger.error(
				{ eventId: row.id, error: getErrorMessage(error) },
				"re-run aborted — event unusable under current and stored form",
			);
			return;
		}
		event = stored.data as RepoScopedEvent;
	}

	/**
	 * Head as of NOW: context reads fetch diff/commits fresh by number, but the
	 * stored event carries the head SHA of the original webhook. If the head
	 * moved since, the run row and the check must target the CURRENT head, not
	 * a stale commit invisible on the PR page.
	 */
	if (deps.reads && "changeRequest" in event) {
		try {
			const commits = await deps.reads.getCommits(
				event.repo.fullName,
				event.changeRequest.number,
			);
			const freshSha = commits.at(-1)?.sha;
			if (freshSha && freshSha !== event.changeRequest.headSha) {
				logger.info(
					{ old: event.changeRequest.headSha, fresh: freshSha },
					"re-run head moved — targeting current head",
				);
				event = {
					...event,
					changeRequest: { ...event.changeRequest, headSha: freshSha },
				};
			}
		} catch (error) {
			logger.warn(
				{ error: getErrorMessage(error) },
				"fresh head fetch failed — re-run targets the stored head",
			);
		}
	}

	const surfaceDeps = {
		db,
		adapter: deps.adapter,
		logger,
		appUrl: deps.appUrl,
	};

	const result = await runWorkflows(
		{
			db,
			logger,
			reads: deps.reads,
			makeGenerate: deps.makeGenerate,
			triggeredBy: job.requestedBy,
			onBeforeEvaluate: () => emitPendingCheck(surfaceDeps, event),
		},
		event,
		row.id,
	);
	if (result.runId && result.verdict) {
		await emitPrSurface(surfaceDeps, {
			runId: result.runId,
			verdict: result.verdict,
			event,
			reasons: result.reasons,
			degraded: result.degraded,
			rerun: true,
			pendingActionRows: result.actionRows,
		});
	}
	logger.info(
		{
			repo: job.repoFullName,
			number: job.number,
			runId: result.runId,
			verdict: result.verdict,
			requestedBy: job.requestedBy,
		},
		"manual re-run completed",
	);
	await pool.query("SELECT pg_notify('runs', $1)", [row.id]);
}
