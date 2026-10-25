import type { Verdict } from "./runs.ts";

export const NOTE_FALLBACK = "No description provided.";

export const VERDICT_RANK = {
	pass: 0,
	needs_review: 1,
	changes_required: 2,
	block: 3,
	close: 4,
} as const satisfies Record<Verdict, number>;

export const HELD_VERDICTS = [
	"block",
	"changes_required",
	"close",
] as const satisfies readonly Verdict[];

export function isHeldVerdict(verdict: string | null | undefined): boolean {
	return HELD_VERDICTS.some((held) => held === verdict);
}

export function joinVerdicts(verdicts: readonly Verdict[]): Verdict {
	return verdicts.reduce<Verdict>(
		(worst, verdict) =>
			VERDICT_RANK[verdict] > VERDICT_RANK[worst] ? verdict : worst,
		"pass",
	);
}

export interface RunStanding {
	closes: number;
	blocks: number;
	fixes: number;
	reviewsPending: number;
}

export function standingVerdict(standing: RunStanding): Verdict {
	if (standing.closes > 0) {
		return "close";
	}
	if (standing.blocks > 0) {
		return "block";
	}
	if (standing.fixes > 0) {
		return "changes_required";
	}
	if (standing.reviewsPending > 0) {
		return "needs_review";
	}
	return "pass";
}
