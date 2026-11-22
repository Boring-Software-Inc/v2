import { captureMessage } from "@sentry/bun";
import type { Forge } from "@tripwire/contracts";

export interface ForgeActionFailure {
	actionId: string;
	runId: string;
	repo: string;
	forge: Forge;
	kind: string;
	phase: "initial" | "retry" | "abandoned";
	reason: string;
	status?: number;
	detail?: string;
}

export type ReportForgeActionFailure = (failure: ForgeActionFailure) => void;

export function forgeActionFailureEvent(failure: ForgeActionFailure) {
	return {
		level: "error" as const,
		fingerprint: [
			"forge-action-failure",
			failure.forge,
			failure.kind,
			failure.reason,
		],
		tags: {
			forge: failure.forge,
			action_kind: failure.kind,
			phase: failure.phase,
			reason: failure.reason,
			...(failure.status === undefined
				? {}
				: { provider_status: String(failure.status) }),
		},
		extra: {
			action_id: failure.actionId,
			run_id: failure.runId,
			repo: failure.repo,
			detail: failure.detail,
		},
	};
}

export function forgeActionFailureReporter(
	capture: typeof captureMessage = captureMessage,
): ReportForgeActionFailure {
	return (failure) => {
		capture("forge moderation action failed", forgeActionFailureEvent(failure));
	};
}

export const reportForgeActionFailureToSentry: ReportForgeActionFailure =
	forgeActionFailureReporter();
