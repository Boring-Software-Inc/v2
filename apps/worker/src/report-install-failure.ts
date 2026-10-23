import { captureMessage, type SeverityLevel } from "@sentry/bun";
import type { Logger } from "pino";

export type InstallFailureState =
	| "unreadable"
	| "not-for-tripwire"
	| "token-expired"
	| "not-admin"
	| "unverifiable"
	| "recovery-failed";

export interface InstallFailure {
	state: InstallFailureState;
	installationId: string;
	userId: string | null;
	error?: string;
}

export type ReportInstallFailure = (failure: InstallFailure) => void;

const INSTALL_FAILURE_LEVEL = {
	"not-for-tripwire": "warning",
	"token-expired": "warning",
	"not-admin": "warning",
	unreadable: "error",
	unverifiable: "error",
	"recovery-failed": "error",
} satisfies Record<InstallFailureState, SeverityLevel>;

export function installFailureEvent(failure: InstallFailure) {
	return {
		level: INSTALL_FAILURE_LEVEL[failure.state],
		tags: {
			installation_id: failure.installationId,
			state: failure.state,
		},
		user: failure.userId === null ? undefined : { id: failure.userId },
		extra: { error: failure.error },
	};
}

export function installFailureReporter(
	logger: Logger,
	capture: typeof captureMessage = captureMessage,
): ReportInstallFailure {
	return (failure) => {
		logger.error(
			{
				tags: {
					installation_id: failure.installationId,
					state: failure.state,
				},
				user: { id: failure.userId },
				error: failure.error,
			},
			"install flow failure",
		);
		capture(
			`install flow failure: ${failure.state}`,
			installFailureEvent(failure),
		);
	};
}
