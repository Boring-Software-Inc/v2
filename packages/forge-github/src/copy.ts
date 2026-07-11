import type { Verdict } from "@tripwire/contracts";

/**
 * Every user-facing string the bot writes to GitHub — the one place to tune
 * the voice. Governed by `.claude/rules/constitution.md` (blocked/passed/sent
 * to review; never rejected/denied/failed; terse, lowercase-friendly, zero
 * exclamation marks). Lives in the GitHub adapter because that is who renders
 * it; when a second forge adapter lands, lift the forge-neutral pieces to a
 * shared home (DECISIONS.md). Structural tokens (the `<!-- tripwire:run -->`
 * marker, the badge path) stay with the presenters — they are not copy.
 */

/** The verdict as a bare word — used in the bold line and the check summary. */
export const VERDICT_WORD: Record<Verdict, string> = {
	pass: "passed",
	block: "blocked",
	needs_review: "sent to review",
};

/** The comment's bold headline. */
export function verdictHeadline(verdict: Verdict): string {
	return `**tripwire: ${VERDICT_WORD[verdict]}**`;
}

/**
 * The ONE contributor-facing sentence. `block` names the count; `needs_review`
 * distinguishes the degraded (fail-closed floor) case.
 */
export function verdictSentence(
	verdict: Verdict,
	stats: { evaluated: number; failed: number },
	degraded = false,
): string {
	if (verdict === "block") {
		const rules = stats.failed === 1 ? "rule" : "rules";
		return `this change tripped ${stats.failed} of ${stats.evaluated} ${rules}. it can't merge until they clear.`;
	}
	if (verdict === "needs_review") {
		return degraded
			? "couldn't finish checking this change, so a maintainer will make the call."
			: "this change needs a maintainer's eyes before it can merge.";
	}
	return `cleared all ${stats.evaluated} rules — good to merge.`;
}

/** The collapsible that holds the run button. */
export const MAINTAINER_SUMMARY = "for maintainers";
export const MAINTAINER_INTRO =
	"every rule, its evidence, and the AI review are on the run page:";

/** Alt text on the "View on Tripwire" button image. */
export const BUTTON_ALT = "View on Tripwire";

/** The request-changes review body — defers to the comment, never restates. */
export const REVIEW_BODY =
	"blocked by tripwire — the details are in the tripwire comment on this PR.";

/** The `pending` check emitted while evaluation is in flight (§5.6b). */
export const PENDING_CHECK_SUMMARY =
	"tripwire is evaluating this change request.";

/** The check run summary — mirrors the comment's verdict line + sentence. */
export function checkSummary(verdict: Verdict, sentence: string): string {
	return `tripwire: ${VERDICT_WORD[verdict]} — ${sentence}`;
}
