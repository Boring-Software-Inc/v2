import { captureException } from "@sentry/bun";
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

const RETRY_REPORT_INTERVAL_MS = 5 * 60_000;

export function forgeActionFailureTitle(failure: ForgeActionFailure): string {
	const status = failure.status === undefined ? "" : ` HTTP ${failure.status}`;
	return `${failure.forge} ${failure.kind} action failed: ${failure.reason}${status}`;
}

export function forgeActionFailureEvent(failure: ForgeActionFailure) {
	const tags = {
		forge: failure.forge,
		action_kind: failure.kind,
		phase: failure.phase,
		reason: failure.reason,
		provider_status:
			failure.status === undefined ? "none" : String(failure.status),
	};
	return {
		level: "error" as const,
		fingerprint: [
			"forge-action-failure",
			failure.forge,
			failure.kind,
			failure.reason,
		],
		tags,
		extra: {
			action_id: failure.actionId,
			run_id: failure.runId,
			repo: failure.repo,
			detail: failure.detail,
		},
	};
}

export function forgeActionFailureReporter(
	capture: typeof captureException = captureException,
	now: () => number = Date.now,
): ReportForgeActionFailure {
	const reported = new Map<string, number>();
	return (failure) => {
		const key = [
			failure.actionId,
			failure.phase,
			failure.reason,
			failure.status ?? "none",
		].join(":");
		const current = now();
		if (
			failure.phase === "retry" &&
			current - (reported.get(key) ?? 0) < RETRY_REPORT_INTERVAL_MS
		)
			return;
		reported.set(key, current);
		capture(
			new Error(forgeActionFailureTitle(failure)),
			forgeActionFailureEvent(failure),
		);
	};
}

export const reportForgeActionFailureToSentry: ReportForgeActionFailure =
	forgeActionFailureReporter();
