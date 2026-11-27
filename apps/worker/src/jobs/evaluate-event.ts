import { eventServices, type GithubEvaluateJob } from "@tripwire/db";
import { type ProcessEventDeps, processEvent } from "./process-event.ts";

/**
 * The `github-evaluate` lane. Events arrive normalized by ingest, and a PR's
 * events run one at a time in the order they arrived.
 *
 * A push that a newer push or reopen on the same PR has already replaced
 * finishes without a run: its check would land on a head the PR no longer
 * has. A PR pushed to 30 times while the queue was backed up gets one
 * evaluation, of its newest head.
 */
export async function evaluateEvent(
	deps: ProcessEventDeps,
	job: GithubEvaluateJob,
): Promise<void> {
	const event = await eventServices.getEventById(deps.db, job.eventId);
	if (
		event?.kind === "change-request.updated" &&
		event.repoFullName &&
		event.subjectNumber !== null
	) {
		const latest = await eventServices.getLatestChangeRequestEvent(
			deps.db,
			{ forge: event.forge, fullName: event.repoFullName },
			event.subjectNumber,
		);
		// UUIDv7 ids sort in arrival order.
		if (latest && latest.id > event.id) {
			deps.logger.info(
				{ eventId: event.id, supersededBy: latest.id },
				"push superseded by a newer one on the same PR: no run",
			);
			await deps.pool.query("SELECT pg_notify('runs', $1)", [event.id]);
			return;
		}
	}
	await processEvent({ ...deps, resumeNormalized: true }, job);
}
