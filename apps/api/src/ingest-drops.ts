import type { IngestDropReason } from "@tripwire/db";
import type { Logger } from "pino";

/**
 * `unsubscribed`: GitHub sent a delivery kind Tripwire never reads (check
 * suites arrive without a subscription). The rest come from ingest's routing.
 */
export type WebhookDropReason = IngestDropReason | "unsubscribed";

export interface IngestDropTally {
	add(reason: WebhookDropReason, eventName: string): void;
}

/**
 * Counts webhooks acknowledged without being stored and logs the totals once a
 * minute, so what ingest cuts stays visible without a log line per delivery.
 */
export function startIngestDropTally(logger: Logger, intervalMs = 60_000) {
	const counts = new Map<string, number>();
	const flush = () => {
		if (counts.size === 0) return;
		logger.info(
			{ event: "webhook.dropped", counts: Object.fromEntries(counts) },
			"webhooks dropped at ingest",
		);
		counts.clear();
	};
	const timer = setInterval(flush, intervalMs);
	timer.unref();
	return {
		add(reason: WebhookDropReason, eventName: string) {
			const key = `${eventName}:${reason}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		},
		flush,
		stop() {
			clearInterval(timer);
			flush();
		},
	};
}
