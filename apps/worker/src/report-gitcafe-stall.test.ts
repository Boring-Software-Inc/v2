import { expect, test } from "bun:test";
import type { captureMessage } from "@sentry/bun";
import { gitCafeStallReporter } from "./report-gitcafe-stall.ts";

test("stalled GitCafe events produce one grouped Sentry error", () => {
	const calls: Parameters<typeof captureMessage>[] = [];
	gitCafeStallReporter((...args) => {
		calls.push(args);
		return "event-id";
	})({
		eventId: "event-id",
		deliveryId: "delivery-id",
		rawKind: "issue.created",
		ageMs: 91_000,
		recoveryAttempts: 1,
	});
	expect(calls).toEqual([
		[
			"GitCafe event stalled",
			{
				level: "error",
				fingerprint: ["gitcafe-event-stalled", "issue.created"],
				tags: {
					forge: "gitcafe",
					stage: "process-event",
					raw_kind: "issue.created",
				},
				extra: {
					event_id: "event-id",
					delivery_id: "delivery-id",
					age_ms: 91_000,
					recovery_attempts: 1,
				},
			},
		],
	]);
});
