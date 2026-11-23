import { captureException } from "@sentry/bun";

export interface GitCafeStall {
	eventId: string;
	deliveryId: string;
	rawKind: string;
	ageMs: number;
	recoveryAttempts: number;
}

export type ReportGitCafeStall = (stall: GitCafeStall) => void;

export function gitCafeStallReporter(
	capture: typeof captureException = captureException,
): ReportGitCafeStall {
	return (stall) => {
		capture(new Error(`GitCafe ${stall.rawKind} event stalled`), {
			level: "error",
			fingerprint: ["gitcafe-event-stalled", stall.rawKind],
			tags: {
				forge: "gitcafe",
				stage: "process-event",
				raw_kind: stall.rawKind,
			},
			extra: {
				event_id: stall.eventId,
				delivery_id: stall.deliveryId,
				age_ms: stall.ageMs,
				recovery_attempts: stall.recoveryAttempts,
			},
		});
	};
}

export const reportGitCafeStallToSentry = gitCafeStallReporter();
