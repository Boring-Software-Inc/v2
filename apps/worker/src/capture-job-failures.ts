import { captureException } from "@sentry/bun";
import type { WorkHandler } from "pg-boss";

export function captureJobFailures<T>(
	queue: string,
	handler: WorkHandler<T>,
): WorkHandler<T> {
	return async (jobs) => {
		try {
			return await handler(jobs);
		} catch (error) {
			captureException(error, { tags: { queue } });
			throw error;
		}
	};
}
