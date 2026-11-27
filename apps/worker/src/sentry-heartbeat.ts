import { captureCheckIn } from "@sentry/bun";

type MonitorConfig = NonNullable<Parameters<typeof captureCheckIn>[1]>;

/**
 * Two missed minutes in a row open a Sentry issue; the first check-in after
 * that resolves it. Sentry creates the monitor on the first check-in, one per
 * Sentry environment.
 */
const EVERY_MINUTE = {
	schedule: { type: "interval", value: 1, unit: "minute" },
	checkinMargin: 1,
	maxRuntime: 1,
	failureIssueThreshold: 2,
	recoveryThreshold: 1,
} satisfies MonitorConfig;

/**
 * Checks in with a Sentry cron monitor every minute while this worker leads
 * the fence. It is the alarm for a worker that stopped, which can't report
 * itself. The api's queue alerts catch a worker that runs but falls behind.
 */
export function startSentryHeartbeat(
	monitorSlug: string,
	isLeader: () => boolean,
	checkIn: typeof captureCheckIn = captureCheckIn,
): () => void {
	const beat = () => {
		if (isLeader()) checkIn({ monitorSlug, status: "ok" }, EVERY_MINUTE);
	};
	beat();
	const timer = setInterval(beat, 60_000);
	return () => clearInterval(timer);
}
