import type { Logger } from "pino";

export type InstallFailureState =
	| "unreadable"
	| "not-for-tripwire"
	| "token-expired"
	| "unverifiable"
	| "recovery-failed";

export interface InstallFailure {
	state: InstallFailureState;
	installationId: string;
	userId: string | null;
	error?: string;
}

export type ReportInstallFailure = (failure: InstallFailure) => void;

export function installFailureReporter(logger: Logger): ReportInstallFailure {
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
	};
}
