import type { ReportRun } from "#/components/onboarding/onboarding-draft";

/**
 * The run to show for what the user reported: the newest report first, its
 * re-run started this visit if there is one, else the newest run stored on
 * it. Check, Workflow and the prefetch all ask this, so they agree on the
 * page and the page loaded ahead is the page shown.
 */
export function newestReportedRunId(
	reported: readonly number[],
	stored: readonly { number: number; latestRunId: string | null }[] | undefined,
	started: Readonly<Record<number, ReportRun>> = {},
): string | null {
	for (const number of [...reported].reverse()) {
		const run = started[number];
		if (run?.status === "queued") {
			return run.runId;
		}
		const latest = stored?.find((cr) => cr.number === number)?.latestRunId;
		if (latest) {
			return latest;
		}
	}
	return null;
}
