import { expect, test } from "bun:test";
import type { captureMessage } from "@sentry/bun";
import { gitCafePreparationFailureReporter } from "./report-gitcafe-preparation-failure.ts";

test("GitCafe preparation failures retain provider context", () => {
	const calls: Parameters<typeof captureMessage>[] = [];
	const report = gitCafePreparationFailureReporter((...args) => {
		calls.push(args);
		return "event-id";
	});
	report({
		eventId: "event-1",
		deliveryId: "delivery-1",
		rawKind: "pull.created",
		reason: "http",
		status: 404,
		retryable: true,
	});
	expect(calls).toEqual([
		[
			"GitCafe event preparation failed",
			expect.objectContaining({
				level: "warning",
				fingerprint: ["gitcafe-event-preparation", "pull.created", "http"],
				tags: expect.objectContaining({
					provider_status: "404",
					retryable: "true",
				}),
				extra: {
					event_id: "event-1",
					delivery_id: "delivery-1",
				},
			}),
		],
	]);
});
