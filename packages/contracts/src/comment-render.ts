import type { BlockCommentConfig } from "./response.ts";
import { ruleContributorLabel, ruleDisplayName } from "./rules.ts";
import type { Verdict } from "./runs.ts";

/**
 * The PR comment's pure render layer — every user-facing string the bot writes
 * to GitHub, and the one function that assembles them. Governed by
 * `.claude/rules/constitution.md` (blocked/passed/sent to review; never
 * rejected/denied/failed; terse, lowercase-friendly, zero exclamation marks).
 *
 * Moved here from `@tripwire/forge-github` (customize build step): the worker
 * renders the REAL comment and the web /customize preview renders the SAME
 * function, and web may not import the forge adapter (§3). Everything in this
 * file is string-in string-out; the adapter keeps the posting (upsert,
 * supersede) and the check-side copy.
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
	/** Bare rule id ("account-age") — resolves the catalog's contributor label
	 * for non-full block-comment modes. Optional: full mode never reads it. */
	ruleId?: string;
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

/** Alt text on the "View on Tripwire" button image. */
export const BUTTON_ALT = "View on Tripwire";

/** The check run's name on the change request — the gate's identity. */
export const CHECK_NAME = "tripwire";

/** The CHANGES_REQUESTED review stamp — one line, no link, no button. */
export function reviewBody(reasons: CommentReason[]): string {
	const first = reasons[0]?.text;
	return first
		? `blocked — ${first}.`
		: "blocked — this change can't merge yet.";
}

/** The check run summary — mirrors the verdict, no "tripwire:" prefix. Moved
 * here with the render layer so the /customize preview shows the REAL check
 * line, not a paraphrase. */
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

/** Stable identifier in EVERY live tripwire comment (also drives `byTripwire`). */
export const COMMENT_MARKER = "<!-- tripwire:run -->";
export const BADGE_PATH = "/badges/view-run.png";
/** The button's intrinsic 1x design width — the 3x asset renders crisp. */
const BADGE_WIDTH = 185;

export interface CommentInput {
	verdict: Verdict;
	/** The contributor, @-mentioned on blocked + sent-to-review. */
	contributorLogin: string;
	/** The failing rules' reasons (block only); empty for pass / needs_review. */
	reasons: CommentReason[];
	runUrl: string;
	/** Absolute URL to the button PNG (`${appUrl}${BADGE_PATH}`). */
	badgeUrl: string;
	/** Fail-closed floor fired — the headline names the degradation. */
	degraded?: boolean;
	/** The active comment's verdict — drives the resolution headline (§7). */
	previousVerdict?: Verdict | null;
	/** Manual re-run: adds the quiet re-evaluation note under the headline. */
	rerun?: boolean;
}

function runButton(input: CommentInput): string {
	return `<a href="${input.runUrl}"><img src="${input.badgeUrl}" width="${BADGE_WIDTH}" alt="${BUTTON_ALT}" /></a>`;
}

/**
 * THE comment (§7), full form: the verdict line, the failing rules'
 * plain-English reasons, the "View on Tripwire" run button (VISIBLE — the run
 * page is the contributor's appeal surface, §10), and collapsible "how do i fix
 * this?" / "what is tripwire?" blocks. The hidden marker makes subsequent
 * events EDIT the comment (upsert) — tripwire never litters a thread.
 *
 * This is `blockComment.mode: "full"` — the default, and the locked baseline:
 * its output is snapshot-tested and must never drift (a repo that never opened
 * /customize gets exactly this).
 */
export function renderCommentBody(input: CommentInput): string {
	const button = runButton(input);
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const lines: string[] = [headline, ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	if (input.verdict === "block") {
		lines.push(reasonsBlock(input.reasons), "", button, "");
		lines.push(howDoIFix(input.reasons), "", WHAT_IS_TRIPWIRE);
	} else if (input.verdict === "needs_review") {
		lines.push(button, "", WHAT_IS_TRIPWIRE);
	} else {
		lines.push(button);
	}
	lines.push(COMMENT_MARKER, "");
	return lines.join("\n");
}

/** One-liner-link line: the rule's contributor label, name-prefixed on demand. */
function oneLinerLine(reason: CommentReason, showRuleName: boolean): string {
	const label =
		(reason.ruleId ? ruleContributorLabel(reason.ruleId) : null) ??
		reasonLine(reason);
	return showRuleName && reason.ruleId
		? `${ruleDisplayName(reason.ruleId)}: ${label}`
		: label;
}

/**
 * custom-mode template substitution: `{{ruleName}}` is the failing rule's
 * contributor label; `{{runUrl}}` renders the "View on Tripwire" BUTTON (the
 * linked badge image), not a bare URL — the run page is the appeal surface
 * (§10) and the button is how every other mode presents it.
 */
function renderTemplate(input: CommentInput, template: string): string {
	const firstRuleId = input.reasons.find((r) => r.ruleId)?.ruleId;
	const ruleName =
		(firstRuleId ? ruleContributorLabel(firstRuleId) : null) ??
		input.reasons[0]?.text ??
		"";
	return template
		.replaceAll("{{ruleName}}", ruleName)
		.replaceAll("{{runUrl}}", runButton(input));
}

/**
 * The config-aware comment renderer — THE shared function: the worker posts
 * what it returns, and the /customize preview shows what it returns. The
 * block-comment mode only reshapes BLOCK comments; pass and sent-to-review
 * always render full (they carry no reasons to trim). Every mode ends with the
 * hidden marker — the upsert lifecycle (§7) depends on it.
 *
 * one-liner-link speaks ONE line per failed rule — never "plus N other
 * things"; hiding which rules fired is the exact confusion this mode exists to
 * avoid. custom renders the maintainer's template verbatim after var
 * substitution: no headline, no button — the template IS the body.
 */
export function renderVerdictComment(
	input: CommentInput,
	blockComment: BlockCommentConfig,
): string {
	if (input.verdict !== "block" || blockComment.mode === "full") {
		return renderCommentBody(input);
	}
	if (blockComment.mode === "custom") {
		const body = renderTemplate(input, blockComment.template).trim();
		return [body, "", COMMENT_MARKER, ""].join("\n");
	}
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const lines: string[] = [headline, ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	if (blockComment.mode === "one-liner-link" && input.reasons.length > 0) {
		lines.push(
			input.reasons
				.map((reason) => oneLinerLine(reason, blockComment.showRuleName))
				.join("\n\n"),
			"",
		);
	}
	lines.push(runButton(input), "", COMMENT_MARKER, "");
	return lines.join("\n");
}
