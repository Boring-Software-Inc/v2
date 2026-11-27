import type { deliveryAuditServices } from "@tripwire/db";
import {
	type GithubAppDeliveries,
	type GithubDelivery,
	githubDeliveryMustBeStored,
	normalizeWebhook,
} from "@tripwire/forge-github";
import type { Logger } from "pino";

export const AUDIT_GITHUB_DELIVERIES_QUEUE = "audit-github-deliveries";
export const AUDIT_GITHUB_DELIVERIES_CRON = "*/5 * * * *";

/** GitHub keeps three days of deliveries; stay inside that. */
const LOG_WINDOW_MS = 71 * 60 * 60 * 1000;
/** Rescanned each run, for deliveries GitHub lists a little late. */
const OVERLAP_MS = 10 * 60 * 1000;
/** A delivery this recent may still be in flight. */
const SETTLE_MS = 60 * 1000;
/** First run: how far back to look. */
const FIRST_SCAN_MS = 60 * 60 * 1000;
/** A redelivery with no answer after this counts as failed. */
export const REDELIVERY_WAIT_MS = 15 * 60 * 1000;
/** Per run, so an outage's backlog can't flood GitHub's API. */
const MAX_REDELIVERIES = 25;
const MAX_PAYLOAD_READS = 100;

type Store = deliveryAuditServices.DeliveryAuditStore;
type ProblemStatus = deliveryAuditServices.DeliveryProblemStatus;

export interface AuditGithubDeliveriesDeps {
	store: Store;
	deliveries: Pick<GithubAppDeliveries, "listSince" | "payload" | "redeliver">;
	logger: Logger;
	now?: () => Date;
}

export interface DeliveryAuditSummary {
	checked: number;
	redelivered: number;
	failed: number;
	missed: number;
	recovered: number;
}

/**
 * Compares GitHub's delivery log with the events table, so a webhook Tripwire
 * should have acted on is never lost without a page:
 * - When every attempt failed (the api was down, deploying, or rejected the
 *   signature), it asks GitHub to redeliver once, and pages if that fails too.
 * - When ingest answered 200 but stored nothing for a delivery it had to keep,
 *   it pages: that is an ingest bug, and redelivering would drop it again.
 * Pages go through `github_delivery_audit` and the api's queue alerts.
 */
export async function auditGithubDeliveries(
	deps: AuditGithubDeliveriesDeps,
): Promise<DeliveryAuditSummary> {
	const { store } = deps;
	const now = (deps.now ?? (() => new Date()))();
	const cursor = await store.readCursor();
	const since = new Date(
		Math.max(
			(cursor?.getTime() ?? now.getTime() - FIRST_SCAN_MS) - OVERLAP_MS,
			now.getTime() - LOG_WINDOW_MS,
		),
	);
	const until = new Date(now.getTime() - SETTLE_MS);
	const attempts = (await deps.deliveries.listSince(since)).filter(
		(attempt) => attempt.deliveredAt <= until,
	);
	const byGuid = groupAttempts(attempts);
	const guids = [...byGuid.keys()];
	const [stored, problems, targets] = await Promise.all([
		store.storedDeliveryGuids(guids),
		store.deliveryProblems(guids),
		store.deliveryTargets({
			repositoryIds: unique(attempts.map((a) => a.repositoryId)),
			installationIds: unique(attempts.map((a) => a.installationId)),
		}),
	]);

	const summary: DeliveryAuditSummary = {
		checked: 0,
		redelivered: 0,
		failed: 0,
		missed: 0,
		recovered: 0,
	};
	let payloadReads = 0;
	// Oldest first, so a run that hits a cap leaves the cursor before the rest.
	let reached = until;
	for (const [guid, tries] of byGuid) {
		const first = tries[0];
		const latest = tries[tries.length - 1];
		if (!(first && latest)) continue;
		const repo =
			latest.repositoryId === null
				? null
				: (targets.repos.get(latest.repositoryId) ?? null);
		const claimedAt =
			latest.installationId === null
				? null
				: (targets.claimedInstallations.get(latest.installationId) ?? null);
		const mustStore = githubDeliveryMustBeStored(
			latest.event,
			latest.action ?? undefined,
			{ installationClaimed: claimedAt !== null, repo },
		);
		if (!mustStore) continue;
		summary.checked++;
		const problem = problems.get(guid);
		const record = (attempt: GithubDelivery, status: ProblemStatus) =>
			store.recordDeliveryProblem({
				guid,
				attemptId: attempt.id,
				event: attempt.event,
				action: attempt.action,
				installationId: attempt.installationId,
				repositoryId: attempt.repositoryId,
				deliveredAt: first.deliveredAt,
				statusCode: attempt.statusCode,
				status,
			});

		if (stored.has(guid)) {
			if (
				problem &&
				problem.status !== "recovered" &&
				problem.status !== "ignored"
			) {
				await record(latest, "recovered");
				summary.recovered++;
				deps.logger.info({ guid }, "lost GitHub delivery recovered");
			}
			continue;
		}

		const answered = tries.find((attempt) => isSuccess(attempt.statusCode));
		if (!answered) {
			if (!problem) {
				if (summary.redelivered >= MAX_REDELIVERIES) {
					reached = minDate(reached, first.deliveredAt);
					continue;
				}
				await deps.deliveries.redeliver(latest.id);
				await record(latest, "redelivered");
				summary.redelivered++;
				deps.logger.warn(
					{ guid, event: latest.event, statusCode: latest.statusCode },
					"GitHub delivery failed; asked GitHub to redeliver",
				);
			} else if (
				problem.status === "redelivered" &&
				now.getTime() - problem.updatedAt.getTime() > REDELIVERY_WAIT_MS
			) {
				await record(latest, "failed");
				summary.failed++;
				deps.logger.error(
					{ guid, event: latest.event, statusCode: latest.statusCode },
					"GitHub delivery failed again after redelivery",
				);
			}
			continue;
		}

		if (problem?.status === "missed" || problem?.status === "ignored") continue;
		// Ingest routed this attempt on the settings of the time. After a repo
		// is armed or claimed, or gains a push workflow, today's settings would
		// call an earlier, rightly dropped delivery missed.
		if (
			(repo && repo.changedAt > answered.deliveredAt) ||
			(claimedAt && claimedAt > answered.deliveredAt)
		)
			continue;
		if (payloadReads >= MAX_PAYLOAD_READS) {
			reached = minDate(reached, first.deliveredAt);
			continue;
		}
		payloadReads++;
		if (!(await producesEvent(deps.deliveries, answered))) {
			// Recorded so overlapping scans don't read the payload again, and so
			// a redelivery of a no-op edit resolves instead of timing out.
			await record(answered, "ignored");
			continue;
		}
		await record(answered, "missed");
		summary.missed++;
		deps.logger.error(
			{
				guid,
				event: answered.event,
				action: answered.action,
				repositoryId: answered.repositoryId,
			},
			"GitHub delivery was acknowledged but never stored",
		);
	}

	// A redelivery GitHub never sent leaves no attempt in later scans.
	const unanswered = (
		await store.redeliveriesUpdatedBefore(
			new Date(now.getTime() - REDELIVERY_WAIT_MS),
		)
	).filter((problem) => !byGuid.has(problem.guid));
	const recoveredLate = await store.storedDeliveryGuids(
		unanswered.map((problem) => problem.guid),
	);
	for (const problem of unanswered) {
		const status = recoveredLate.has(problem.guid) ? "recovered" : "failed";
		await store.setDeliveryProblemStatus(problem.guid, status);
		summary[status]++;
		if (status === "failed")
			deps.logger.error(
				{ guid: problem.guid, event: problem.event },
				"GitHub delivery failed again after redelivery",
			);
	}

	// A lost delivery stored later, by a manual redelivery or a backfill, stops
	// paging even once it is past the scan window.
	const lost = (await store.lostDeliveryGuids()).filter(
		(guid) => !byGuid.has(guid),
	);
	for (const guid of await store.storedDeliveryGuids(lost)) {
		await store.setDeliveryProblemStatus(guid, "recovered");
		summary.recovered++;
		deps.logger.info({ guid }, "lost GitHub delivery recovered");
	}

	await store.advanceCursor(reached);
	await store.prune();
	if (summary.checked > 0 || summary.failed > 0)
		deps.logger.info(
			{ ...summary, since, until: reached },
			"deliveries audited",
		);
	return summary;
}

/** Attempts by guid, each oldest first; guids in order of first delivery. */
function groupAttempts(
	attempts: readonly GithubDelivery[],
): Map<string, GithubDelivery[]> {
	const sorted = [...attempts].sort(
		(a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime(),
	);
	const byGuid = new Map<string, GithubDelivery[]>();
	for (const attempt of sorted) {
		const tries = byGuid.get(attempt.guid) ?? [];
		tries.push(attempt);
		byGuid.set(attempt.guid, tries);
	}
	return byGuid;
}

/**
 * Whether the payload normalizes to an event, as ingest would see it. Bot and
 * label-only edits normalize to nothing and are rightly not stored. A payload
 * that fails to normalize would have been stored for the worker to quarantine,
 * so it counts as an event.
 */
async function producesEvent(
	deliveries: AuditGithubDeliveriesDeps["deliveries"],
	attempt: GithubDelivery,
): Promise<boolean> {
	const { event, body } = await deliveries.payload(attempt.id);
	try {
		return (
			normalizeWebhook(
				{ deliveryId: attempt.guid, eventName: event, body, signature: null },
				attempt.deliveredAt.toISOString(),
			) !== null
		);
	} catch {
		return true;
	}
}

function isSuccess(statusCode: number): boolean {
	return statusCode >= 200 && statusCode < 300;
}

function unique(values: readonly (string | null)[]): string[] {
	return [...new Set(values.filter((value) => value !== null))];
}

function minDate(a: Date, b: Date): Date {
	return a < b ? a : b;
}
