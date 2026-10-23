import { describe, expect, test } from "bun:test";
import type { captureMessage } from "@sentry/bun";
import { unrunnableReporter } from "./report-unrunnable.ts";

describe("unrunnableReporter", () => {
	test("reports one error per workflow, grouped by workflow id", () => {
		const calls: Parameters<typeof captureMessage>[] = [];
		unrunnableReporter((message, context) => {
			calls.push([message, context]);
			return "event-id";
		})({
			repo: "acme/api",
			forge: "github",
			workflowId: "wf-1",
			lintRule: "missing-step",
			scheduled: false,
			messages: ["A connection points at a step that no longer exists."],
		});
		expect(calls).toEqual([
			[
				"live workflow cannot run",
				{
					level: "error",
					fingerprint: ["workflow-unrunnable", "wf-1"],
					tags: {
						repo: "acme/api",
						forge: "github",
						workflow_id: "wf-1",
						lint_rule: "missing-step",
						scheduled: "false",
					},
					extra: {
						messages: ["A connection points at a step that no longer exists."],
					},
				},
			],
		]);
	});
});
