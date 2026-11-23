import { describe, expect, test } from "bun:test";
import type { captureException } from "@sentry/bun";
import {
	forgeActionFailureEvent,
	forgeActionFailureReporter,
	forgeActionFailureTitle,
} from "./report-forge-action-failure.ts";

const failure = {
	actionId: "01a20212-20f8-7000-bcca-3199e56182ed",
	runId: "01a20212-20f8-7000-bcca-3199e56182ec",
	repo: "boring/scratch",
	forge: "gitcafe" as const,
	kind: "comment",
	phase: "initial" as const,
	reason: "http",
	status: 415,
	detail: "sanitized detail",
};

describe("forge action failure reporting", () => {
	test("keeps routing context and provider status out of the message", () => {
		expect(forgeActionFailureEvent(failure)).toEqual({
			level: "error",
			fingerprint: ["forge-action-failure", "gitcafe", "comment", "http"],
			tags: {
				forge: "gitcafe",
				action_kind: "comment",
				phase: "initial",
				reason: "http",
				provider_status: "415",
			},
			extra: {
				action_id: failure.actionId,
				run_id: failure.runId,
				repo: "boring/scratch",
				detail: "sanitized detail",
			},
		});
	});

	test("emits one grouped Sentry event", () => {
		const calls: Parameters<typeof captureException>[] = [];
		forgeActionFailureReporter((...args) => {
			calls.push(args);
			return "event-id";
		})(failure);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[0]).toEqual(
			new Error("gitcafe comment action failed: http HTTP 415"),
		);
		expect(calls[0]?.[1]).toEqual(forgeActionFailureEvent(failure));
		expect(forgeActionFailureTitle(failure)).toBe(
			"gitcafe comment action failed: http HTTP 415",
		);
	});
});
