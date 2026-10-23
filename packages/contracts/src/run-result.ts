import { z } from "zod";
import { verdictSchema } from "./runs.ts";

export const runStatusSchema = z.enum([
	"queued",
	"running",
	"paused",
	"completed",
	"failed",
	"closed",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const RUN_STATUSES: readonly RunStatus[] = runStatusSchema.options;

export const runResultSchema = z.enum([
	"checking",
	"did-not-finish",
	"pass",
	"block",
	"needs_review",
	"closed-before-review",
	"ran",
]);
export type RunResult = z.infer<typeof runResultSchema>;

export const RUN_RESULT_LABELS = {
	checking: "Checking",
	"did-not-finish": "Did not finish",
	pass: "Passed",
	block: "Blocked",
	needs_review: "Waiting for human review",
	"closed-before-review": "Closed before review",
	ran: "Ran",
} as const satisfies Record<RunResult, string>;

export interface RunResultInput {
	status: string;
	verdict: string | null;
	bearsVerdict: boolean;
}

const statusWordSchema = runStatusSchema.nullable().catch(null);
const verdictWordSchema = verdictSchema.nullable().catch(null);

export function runResult(run: RunResultInput): RunResult | null {
	const status = statusWordSchema.parse(run.status);
	if (status === "queued" || status === "running") {
		return "checking";
	}
	if (status === "failed") {
		return "did-not-finish";
	}
	if (status === "closed") {
		return "closed-before-review";
	}
	const verdict = verdictWordSchema.parse(run.verdict);
	if (verdict === null) {
		return null;
	}
	if (verdict === "needs_review" || run.bearsVerdict) {
		return verdict;
	}
	return "ran";
}

export function runResultLabel(result: RunResult | null): string | null {
	return result ? RUN_RESULT_LABELS[result] : null;
}
