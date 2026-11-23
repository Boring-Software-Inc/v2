import { expect, test } from "bun:test";
import type { captureException } from "@sentry/bun";
import type { Job } from "pg-boss";
import { captureJobFailures } from "./capture-job-failures.ts";

test("reports a failed queue job with correlation context and rethrows", async () => {
	const calls: Parameters<typeof captureException>[] = [];
	const failure = new Error("database unavailable");
	const handler = captureJobFailures<{ requestId: string }>(
		"process-event",
		async () => {
			throw failure;
		},
		(...args) => {
			calls.push(args);
			return "event-id";
		},
	);
	const jobs = [
		{
			id: "job-1",
			data: { requestId: "request-1" },
		} as Job<{ requestId: string }>,
	];

	await expect(handler(jobs)).rejects.toBe(failure);
	expect(calls).toEqual([
		[
			failure,
			{
				tags: {
					service: "worker",
					phase: "queue",
					queue: "process-event",
				},
				extra: {
					job_ids: ["job-1"],
					request_ids: ["request-1"],
				},
			},
		],
	]);
});
