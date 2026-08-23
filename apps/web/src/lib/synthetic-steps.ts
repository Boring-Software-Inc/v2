import type { JsonValue, RunStepView } from "#/lib/runs.functions";

/**
 * The two synthetic run-level steps the worker records outside the workflow
 * graph (VERIFICATION-QUEUE #11 — they must read distinctly, never like a
 * graph node): `run:deny-floor` (unit 5 — a maintainer deny with no deny edge
 * floors to block) and `run:degradation` (unit 1 — the fail-closed floor
 * routes a mostly-skipped run to review).
 */

export interface SyntheticStepView {
	kind: "deny-floor" | "degradation";
	title: string;
	detail: string;
}

function asRecord(value: JsonValue): { [key: string]: JsonValue } | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value
		: null;
}

export function describeSyntheticStep(
	step: Pick<RunStepView, "nodeId" | "output">,
): SyntheticStepView | null {
	if (step.nodeId === "run:deny-floor") {
		return {
			kind: "deny-floor",
			title: "denied by maintainer",
			detail:
				"no deny edge drawn — the deny floor blocked this change by default. deny never fails open.",
		};
	}
	if (step.nodeId === "run:degradation") {
		const output = asRecord(step.output);
		const skipped = output?.skippedRules;
		const total = output?.ruleNodes;
		const one = skipped === 1;
		/**
		 * Say what happened, then what it cost. Nothing else.
		 *
		 * The old copy said "evaluation degraded — the fail-closed floor sent this
		 * run to review instead of passing on guesswork". Three problems: the
		 * floor is our word and means nothing to a maintainer, "passing on
		 * guesswork" argues with the reader, and none of it says WHY a rule could
		 * not run. The reason lives on the rule's own step, which is where a
		 * reader looks next.
		 */
		const reads = output?.degradedReads;
		// Each part drops out cleanly when it is unknown, so a malformed step
		// still reads as a sentence instead of "skipped. sent to review."
		const parts = [
			typeof skipped === "number" && typeof total === "number"
				? `${skipped} of ${total} skipped.`
				: null,
			Array.isArray(reads) && reads.length > 0
				? `couldn't read: ${reads.filter((r) => typeof r === "string").join(", ")}.`
				: null,
			// enforced:false ⇒ the maintainer turned the review fallback off.
			output?.enforced === false
				? "passed anyway — the review fallback is off."
				: "sent to review.",
		];
		return {
			kind: "degradation",
			title: one ? "a rule couldn't run" : "some rules couldn't run",
			detail: parts.filter((part) => part !== null).join(" "),
		};
	}
	return null;
}
