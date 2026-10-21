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

const READ_NAMES: Record<string, string> = {
	diff: "the changed files",
	getDiff: "the changed files",
	commits: "the commits",
	getCommits: "the commits",
	contributor: "the contributor's profile",
	getContributorProfile: "the contributor's profile",
};

const UNKNOWN_READ = "some details of the change request";

function joinPhrases(phrases: readonly string[]): string {
	if (phrases.length <= 1) {
		return phrases[0] ?? "";
	}
	return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

export function describeDegradedReads(reads: readonly string[]): string {
	const phrases = [
		...new Set(reads.map((read) => READ_NAMES[read] ?? UNKNOWN_READ)),
	];
	return `Tripwire could not read ${joinPhrases(phrases)}.`;
}

export function describeSyntheticStep(
	step: Pick<RunStepView, "nodeId" | "output">,
): SyntheticStepView | null {
	if (step.nodeId === "run:deny-floor") {
		return {
			kind: "deny-floor",
			title: "Blocked by a maintainer",
			detail:
				"A maintainer chose block in the moderation queue. The workflow has no step for that choice, so Tripwire blocked the change request.",
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
				? `${shape.skippedRules} of ${shape.ruleNodes} rules skipped.`
				: null,
			shape.degradedReads && shape.degradedReads.length > 0
				? describeDegradedReads(shape.degradedReads)
				: null,
			// enforced:false ⇒ the maintainer turned the review fallback off.
			shape.enforced === false
				? "Passed without them. This repo passes change requests when a rule cannot run."
				: "Sent to review.",
		];
		return {
			kind: "degradation",
			title: one ? "A rule could not run" : "Some rules could not run",
			detail: parts.filter((part) => part !== null).join(" "),
		};
	}
	return null;
}
