import type { Verdict } from "@tripwire/contracts";

/**
 * Every user-facing string the bot writes to GitHub — the one place to tune
 * the voice. Governed by `.claude/rules/constitution.md` (blocked/passed/sent
 * to review; never rejected/denied/failed; terse, lowercase-friendly, zero
 * exclamation marks). Lives in the GitHub adapter because that is who renders
 * it; when a second forge adapter lands, lift the forge-neutral pieces to a
 * shared home (DECISIONS.md). Structural tokens (the `<!-- tripwire:run -->`
 * marker, the badge path) stay with the presenters — they are not copy.
 *
 * The comment NEVER counts rules ("tripped 1 of 8") — a stranger can't read
 * that. It speaks the failing rules' plain-English reasons and, for a wait-rule,
 * when it clears. The "tripwire:" prefix is gone everywhere — the bot name
 * already carries it.
 */

/** The verdict as a bare word — the bold line and the check summary. */
export const VERDICT_WORD: Record<Verdict, string> = {
	pass: "passed",
	block: "blocked",
	needs_review: "sent to review",
};

/** What a contributor can do about a blocking rule — mirrors core's rule field. */
export type Remedy = "revise" | "wait" | "appeal";

/** One failing rule as the comment speaks it: its one-liner + how to clear it. */
export interface CommentReason {
	/** The rule's summarize() one-liner (§10) — never a rule name/count. */
	text: string;
	remedy: Remedy;
	/** wait-rules only: a derived, threshold-free "it clears in 5 days". */
	waitHint?: string | null;
}

export interface HeadlineOptions {
	degraded?: boolean;
	/**
	 * The verdict the ACTIVE comment already shows. When it differs from the new
	 * verdict this comment is a RESOLUTION (§7) — the copy acknowledges the
	 * change ("that's cleared") instead of stating it cold. null/undefined ⇒
	 * first-time verdict, original copy.
	 */
	previousVerdict?: Verdict | null;
}

/**
 * The bold first line — carries the verdict and @-mentions the contributor. On a
 * TRANSITION it speaks to the change (the new comment knows the previous verdict).
 */
export function commentHeadline(
	verdict: Verdict,
	login: string,
	options: HeadlineOptions = {},
): string {
	const { degraded = false, previousVerdict = null } = options;
	const transition = previousVerdict !== null && previousVerdict !== verdict;

	if (verdict === "pass") {
		return transition
			? `**passed** — @${login}, that's cleared. good to merge.`
			: "**passed** — nothing tripped. good to merge.";
	}
	if (verdict === "needs_review") {
		if (degraded) {
			return "**sent to review** — couldn't finish checking this change, so a maintainer will decide.";
		}
		return transition && previousVerdict === "block"
			? `**sent to review** — @${login}, that's cleared the rules. a maintainer takes it from here.`
			: `**sent to review** — @${login}, a maintainer needs to look at this before it can merge.`;
	}
	// block
	return transition
		? `**blocked** — @${login}, the last push brought something back.`
		: `**blocked** — @${login}, this can't merge yet.`;
}

/**
 * The re-run note (§7 amendment): one quiet line under the headline so a
 * reader can tell a maintainer deliberately re-evaluated — load-bearing for
 * the same-verdict case, where the comment is silently edited in place and
 * nothing else would show that anything happened.
 */
export const RERUN_NOTE = "re-evaluated under the repo's current rules.";

function reasonLine(reason: CommentReason): string {
	return reason.waitHint ? `${reason.text} — ${reason.waitHint}` : reason.text;
}

/**
 * The reasons block: max 2 inline, each with its wait-hint appended; 3+ collapse
 * to the leading reason plus a count of the rest (never "X of Y rules").
 */
export function reasonsBlock(reasons: CommentReason[]): string {
	if (reasons.length === 0) {
		return "this change can't merge yet.";
	}
	if (reasons.length <= 2) {
		return reasons.map(reasonLine).join("\n\n");
	}
	return `${reasonLine(reasons[0] as CommentReason)}, plus ${reasons.length - 1} other things.`;
}

const FIX_REVISE =
	"fix those and push again — this comment updates itself. no need to reopen the pull request or ping anyone.\n\nif you think this is wrong, say so in a comment here and a maintainer will decide.";
const FIX_NONE =
	"this isn't something a new commit will clear.\n\nif you think this should go through anyway, say so in a comment here and a maintainer will decide.";
const FIX_MIXED =
	"fix what you can and push again — this comment updates itself. the rest won't clear by pushing.\n\nif you think this should go through anyway, say so in a comment here and a maintainer will decide.";

/**
 * The "how do i fix this?" body, chosen by the failing rules' remedies: all
 * revisable ⇒ push again; nothing revisable ⇒ no commit clears it; mixed ⇒ fix
 * what you can. The appeal sentence rides along whenever anything is non-revise.
 */
export function howDoIFix(reasons: CommentReason[]): string {
	const anyRevise = reasons.some((r) => r.remedy === "revise");
	const anyNonRevise = reasons.some((r) => r.remedy !== "revise");
	const body = anyRevise ? (anyNonRevise ? FIX_MIXED : FIX_REVISE) : FIX_NONE;
	return `<details><summary>how do i fix this?</summary>\n\n${body}\n</details>`;
}

/** The shared explainer — appended to blocked and sent-to-review comments. */
export const WHAT_IS_TRIPWIRE =
	"<details><summary>what is tripwire?</summary>\n\na firewall for open-source repos. the maintainers here set rules that every change has to clear before it can merge — account age, rate limits, hidden links, that kind of thing. org members are exempt.\n\nnothing is hidden: the run page shows every rule this change hit, the evidence, and the verdict.\n</details>";

/**
 * A superseded comment (§7): the human text of the old verdict, struck through,
 * pointing at the newer comment below. The button + collapsibles + markers are
 * dropped (everything from the first HTML block on) — a struck-through button is
 * noise. Losing the marker also means the superseded comment is no longer the
 * "active" tripwire comment: exactly one live comment carries the marker.
 */
export function supersededBody(originalBody: string): string {
	const htmlAt = originalBody.search(/<a |<details/);
	const kept = (
		htmlAt >= 0 ? originalBody.slice(0, htmlAt) : originalBody
	).trim();
	const struck = kept
		.split("\n")
		.map((line) => (line.trim() ? `~~${line}~~` : line))
		.join("\n");
	return `${struck}\n\nsuperseded — see the newer check below.`;
}

/** The message stamped on a dismissed request-changes review (§7). */
export const DISMISS_REVIEW_MESSAGE =
	"cleared — this change now passes tripwire's checks.";

/** The CHANGES_REQUESTED review stamp — one line, no link, no button. */
export function reviewBody(reasons: CommentReason[]): string {
	const first = reasons[0]?.text;
	return first
		? `blocked — ${first}.`
		: "blocked — this change can't merge yet.";
}

/** Alt text on the "View on Tripwire" button image. */
export const BUTTON_ALT = "View on Tripwire";

/** The `pending` check emitted while evaluation is in flight (§5.6b). */
export const PENDING_CHECK_SUMMARY =
	"tripwire is evaluating this change request.";

/** The check run summary — mirrors the verdict, no "tripwire:" prefix. */
export function checkSummary(
	verdict: Verdict,
	reasons: CommentReason[],
	degraded = false,
): string {
	if (verdict === "block") {
		return reviewBody(reasons).replace(/\.$/, "");
	}
	if (verdict === "needs_review") {
		return degraded
			? "sent to review — couldn't finish checking this change"
			: "sent to review — a maintainer needs to look at this";
	}
	return "passed — nothing tripped";
}
