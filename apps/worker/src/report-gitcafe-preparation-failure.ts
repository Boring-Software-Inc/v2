import { captureMessage } from "@sentry/bun";

export interface GitCafePreparationFailure {
	eventId: string;
	deliveryId: string;
	rawKind: string;
	reason: string;
	status?: number;
	retryable: boolean;
}

export type ReportGitCafePreparationFailure = (
	failure: GitCafePreparationFailure,
) => void;

export function gitCafePreparationFailureReporter(
	capture: typeof captureMessage = captureMessage,
): ReportGitCafePreparationFailure {
	return (failure) => {
		capture("GitCafe event preparation failed", {
			level: failure.retryable ? "warning" : "error",
			fingerprint: [
				"gitcafe-event-preparation",
				failure.rawKind,
				failure.reason,
			],
			tags: {
				forge: "gitcafe",
				stage: "prepare-event",
				raw_kind: failure.rawKind,
				reason: failure.reason,
				provider_status:
					failure.status === undefined ? "none" : String(failure.status),
				retryable: String(failure.retryable),
			},
			extra: {
				event_id: failure.eventId,
				delivery_id: failure.deliveryId,
			},
		});
	};
}

export const reportGitCafePreparationFailureToSentry =
	gitCafePreparationFailureReporter();
