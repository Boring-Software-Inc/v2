import { captureException } from "@sentry/bun";
import type { WorkHandler } from "pg-boss";
import { z } from "zod";

const jobRequestContextSchema = z.object({ requestId: z.string() });

export function captureJobFailures<T>(
	queue: string,
	handler: WorkHandler<T>,
	capture: typeof captureException = captureException,
): WorkHandler<T> {
	return async (jobs) => {
		try {
			return await handler(jobs);
		} catch (error) {
			const requestIds = jobs.flatMap((job) => {
				const context = jobRequestContextSchema.safeParse(job.data);
				return context.success ? [context.data.requestId] : [];
			});
			capture(error, {
				tags: { service: "worker", phase: "queue", queue },
				extra: {
					job_ids: jobs.map((job) => job.id),
					request_ids: requestIds,
				},
			});
			throw error;
		}
	};
}
