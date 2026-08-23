import { z } from "zod";
import type { RunStepView } from "#/lib/runs.functions";

/**
 * The two synthetic run-level steps the worker records outside the workflow
 * graph (VERIFICATION-QUEUE #11: they must read distinctly, never like a
 * graph node): `run:deny-floor` (unit 5: a maintainer deny with no deny edge
 * floors to block) and `run:degradation` (unit 1: the fail-closed floor
 * routes a mostly-skipped run to review).
 */

export interface SyntheticStepView {
	kind: "deny-floor" | "degradation";
	title: string;
	detail: string;
}

/**
 * What the worker records on `run:degradation`. Every field is optional and a
 * bad shape falls back to empty, so an older stored run, or a newer worker,
 * renders what it has instead of throwing at a maintainer.
 */
const degradationOutputSchema = z
	.object({
		skippedRules: z.number().optional(),
		ruleNodes: z.number().optional(),
		degradedReads: z.array(z.string()).optional(),
		enforced: z.boolean().optional(),
	})
	.catch({});

export function describeSyntheticStep(
	step: Pick<RunStepView, "nodeId" | "output">,
): SyntheticStepView | null {
	if (step.nodeId === "run:deny-floor") {
		return {
			kind: "deny-floor",
			title: "denied by maintainer",
			detail:
				"no deny edge drawn. blocked by default, because deny never fails open.",
		};
	}
	if (step.nodeId === "run:degradation") {
		/**
		 * PARSED, not poked at. The worker writes this step, but it arrives here
		 * as stored json, so the shape is established once at this boundary
		 * rather than re-checked field by field further down.
		 */
		const shape = degradationOutputSchema.parse(step.output);
		const one = shape.skippedRules === 1;
		/**
		 * Say what happened, then what it cost. Nothing else.
		 *
		 * The old copy said "evaluation degraded, the fail-closed floor sent this
		 * run to review instead of passing on guesswork". Three problems: the
		 * floor is our word and means nothing to a maintainer, "passing on
		 * guesswork" argues with the reader, and none of it says WHY a rule could
		 * not run. The reason lives on the rule's own step, which is where a
		 * reader looks next.
		 */
		// Each part drops out cleanly when a field is absent, so a malformed step
		// still reads as a sentence instead of "skipped. sent to review."
		const parts = [
			shape.skippedRules !== undefined && shape.ruleNodes !== undefined
				? `${shape.skippedRules} of ${shape.ruleNodes} skipped.`
				: null,
			shape.degradedReads && shape.degradedReads.length > 0
				? `couldn't read: ${shape.degradedReads.join(", ")}.`
				: null,
			// enforced:false ⇒ the maintainer turned the review fallback off.
			shape.enforced === false
				? "passed without them. this repo is set to pass when a rule can't run."
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
