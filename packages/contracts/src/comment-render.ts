import { type RedactedReasons, redactCommentReasons } from "./redact.ts";
import {
	OPEN_REDACTION,
	type RedactionPolicy,
	redactionLevelFor,
} from "./redaction.ts";
import { commentOverrideFor, type ResponseConfig } from "./response.ts";
import { ruleContributorLabel, ruleDisplayName } from "./rules.ts";
import type { Verdict } from "./runs.ts";

/**
 * The PR comment's pure render layer — every user-facing string the bot writes
 * to GitHub, and the one function that assembles them. Governed by
 * `.claude/rules/constitution.md` (blocked/passed/human review; never
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
	needs_review: "human review",
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
			? `@${login}, this now passes Tripwire's checks.`
			: "This passed Tripwire's checks.";
	}
	if (verdict === "needs_review") {
		if (degraded) {
			return "Tripwire could not finish checking this, so it needs human review. A maintainer will approve or block it.";
		}
		return transition && previousVerdict === "block"
			? `@${login}, Tripwire no longer blocks this, but it needs human review. A maintainer will approve or block it.`
			: `@${login}, this needs human review. A maintainer will approve or block it.`;
	}
	// block
	return transition
		? `@${login}, Tripwire now blocks this.`
		: `@${login}, Tripwire blocked this.`;
}

/**
 * The re-run note (§7 amendment): one quiet line under the headline so a
 * reader can tell a maintainer deliberately re-evaluated — load-bearing for
 * the same-verdict case, where the comment is silently edited in place and
 * nothing else would show that anything happened.
 */
export const RERUN_NOTE =
	"Tripwire checked this again with the repository's current rules.";

function capitalize(text: string): string {
	const trimmed = text.trim();
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function asSentence(text: string): string {
	const capitalized = capitalize(text);
	return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function reasonLine(reason: CommentReason): string {
	return reason.waitHint
		? `${asSentence(reason.text)} ${asSentence(reason.waitHint)}`
		: asSentence(reason.text);
}

/**
 * The reasons block: max 2 inline, each with its wait-hint appended; 3+ collapse
 * to the leading reason plus a count of the rest (never "X of Y rules").
 */
export function reasonsBlock(reasons: CommentReason[]): string {
	if (reasons.length === 0) {
		return "";
	}
	if (reasons.length <= 2) {
		return reasons.map(reasonLine).join("\n\n");
	}
	return `${reasonLine(reasons[0] as CommentReason)}\n\n${reasons.length - 1} more reasons. See all of them on Tripwire.`;
}

function headlineWithReasons(headline: string, reasonList: string): string {
	return reasonList === "" ? headline : `${headline}\n\n${reasonList}`;
}

const FIX_REVISE =
	"Fix the problems listed above, then push a new commit. Tripwire checks this again after every push. You do not need to reopen anything or contact anyone.\n\nIf you think this result is wrong, say so in a comment here. A maintainer will decide.";
const FIX_NONE =
	"A new commit will not fix this.\n\nIf you think this should merge anyway, say so in a comment here. A maintainer will decide.";
const FIX_MIXED =
	"Fix what you can, then push a new commit. Tripwire checks this again after every push. Some of these problems will not go away with a new commit.\n\nIf you think this should merge anyway, say so in a comment here. A maintainer will decide.";

/**
 * The "how do i fix this?" body, chosen by the failing rules' remedies: all
 * revisable ⇒ push again; nothing revisable ⇒ no commit clears it; mixed ⇒ fix
 * what you can. The appeal sentence rides along whenever anything is non-revise.
 */
export function howDoIFix(reasons: CommentReason[]): string {
	const anyRevise = reasons.some((r) => r.remedy === "revise");
	const anyNonRevise = reasons.some((r) => r.remedy !== "revise");
	const body = anyRevise ? (anyNonRevise ? FIX_MIXED : FIX_REVISE) : FIX_NONE;
	return `<details><summary>How do I fix this?</summary>\n\n${body}\n</details>`;
}

/** The shared explainer, appended to blocked and human review comments. */
export const WHAT_IS_TRIPWIRE =
	"<details><summary>What is Tripwire?</summary>\n\nTripwire checks contributions to this repository. The maintainers set the rules, such as rules about account age, how often you open change requests, and hidden links. People with write access to this repository skip these checks.\n\nThe Tripwire page for this check shows every rule it applied, what it found, and the result.\n</details>";

/** Alt text on the "View on Tripwire" button image. */
export const BUTTON_ALT = "View on Tripwire";

/** The check run's name on the change request — the gate's identity. */
export const CHECK_NAME = "tripwire";

/** The CHANGES_REQUESTED review stamp — one line, no link, no button. */
export function reviewBody(reasons: CommentReason[], level = 0): string {
	const detail = leadDetail(redactCommentReasons(reasons, level));
	return detail ? `Tripwire blocked this. ${detail}` : "Tripwire blocked this.";
}

function listNames(names: string[]): string {
	if (names.length <= 1) {
		return names[0] ?? "";
	}
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function redactedReasonLine(
	redacted: Exclude<RedactedReasons, { kind: "reasons" }>,
): string {
	if (redacted.kind === "names") {
		return `It did not meet these rules: ${listNames(redacted.names)}.`;
	}
	if (redacted.kind === "count") {
		return `${redacted.count} ${redacted.count === 1 ? "rule" : "rules"} blocked it.`;
	}
	return "";
}

function leadDetail(redacted: RedactedReasons): string | null {
	if (redacted.kind === "reasons") {
		const first = redacted.reasons[0]?.text;
		return first ? asSentence(first) : null;
	}
	return redactedReasonLine(redacted) || null;
}

/** The check run summary — mirrors the verdict, no "tripwire:" prefix. Moved
 * here with the render layer so the /customize preview shows the REAL check
 * line, not a paraphrase. */
export function checkSummary(
	verdict: Verdict,
	reasons: CommentReason[],
	degraded = false,
	level = 0,
): string {
	if (verdict === "block") {
		const detail = leadDetail(redactCommentReasons(reasons, level));
		return detail ? `Blocked. ${detail}` : "Blocked.";
	}
	if (verdict === "needs_review") {
		return degraded
			? "Waiting for human review. Tripwire could not finish checking this change request."
			: "Waiting for human review.";
	}
	return "Passed. Tripwire found no problems.";
}

/** Stable identifier in EVERY live tripwire comment (also drives `byTripwire`). */
export const COMMENT_MARKER = "<!-- tripwire:run -->";
export const BADGE_PATH = "/badges/view-run.png";
/** The button's intrinsic 1x design width — the 3x asset renders crisp. */
const BADGE_WIDTH = 185;

export interface CommentInput {
	verdict: Verdict;
	/** The contributor, @-mentioned on blocked + human review. */
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
function reasonSection(
	redacted: RedactedReasons,
	line: (reasons: CommentReason[]) => string,
): string {
	return redacted.kind === "reasons"
		? line(redacted.reasons)
		: redactedReasonLine(redacted);
}

export function renderCommentBody(
	input: CommentInput,
	showDetailsButton = true,
	policy: RedactionPolicy = OPEN_REDACTION,
): string {
	const button = runButton(input);
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const showHelp = policy.showHelp;
	const reasonList =
		input.verdict === "block"
			? reasonSection(
					redactCommentReasons(
						input.reasons,
						redactionLevelFor(policy, "comment"),
					),
					reasonsBlock,
				)
			: "";
	const lines: string[] = [headlineWithReasons(headline, reasonList), ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	// showDetailsButton off drops the "View on Tripwire" link (the run page is
	// the appeal surface, §10) while keeping the reasons + generic collapsibles.
	// Default true ⇒ byte-identical to the locked baseline.
	if (input.verdict === "block") {
		if (showDetailsButton) {
			lines.push(button, "");
		}
		if (showHelp) {
			lines.push(howDoIFix(input.reasons), "", WHAT_IS_TRIPWIRE);
		}
	} else if (input.verdict === "needs_review") {
		if (showDetailsButton) {
			lines.push(button, "");
		}
		if (showHelp) {
			lines.push(WHAT_IS_TRIPWIRE);
		}
	} else if (showDetailsButton) {
		lines.push(button);
	}
	lines.push(COMMENT_MARKER, "");
	return lines.join("\n");
}

/** One-liner-link line: the rule's name and its contributor label. */
function oneLinerLine(reason: CommentReason): string {
	const label =
		(reason.ruleId ? ruleContributorLabel(reason.ruleId) : null) ??
		reasonLine(reason);
	return reason.ruleId
		? `${capitalize(ruleDisplayName(reason.ruleId))}: ${asSentence(label)}`
		: asSentence(label);
}

/**
 * custom-mode template substitution: `{{ruleName}}` is the failing rule's
 * contributor label; `{{runUrl}}` renders the "View on Tripwire" BUTTON (the
 * linked badge image), not a bare URL — the run page is the appeal surface
 * (§10) and the button is how every other mode presents it.
 */
function renderTemplate(
	input: CommentInput,
	template: string,
	level: number,
): string {
	const redacted = redactCommentReasons(input.reasons, level);
	const firstRuleId = input.reasons.find((r) => r.ruleId)?.ruleId;
	const ruleName =
		redacted.kind === "count" || redacted.kind === "verdict"
			? ""
			: redacted.kind === "names"
				? (redacted.names[0] ?? "")
				: ((firstRuleId ? ruleContributorLabel(firstRuleId) : null) ??
					redacted.reasons[0]?.text ??
					"");
	return template
		.replaceAll("{{ruleName}}", ruleName)
		.replaceAll("{{runUrl}}", runButton(input));
}

/**
 * The config-aware comment renderer — THE shared function: the worker posts
 * what it returns, and the /customize preview shows what it returns. It resolves
 * the per-outcome override (§customize) itself from the full config, so pass,
 * block, and human review each honor their own custom text + button toggle.
 *
 * `customText`, when set, REPLACES the ENTIRE body for that verdict — headline,
 * reasons, remedies, collapsibles, all of it — leaving only the (optional) run
 * button and the marker. This is the "hide the rules" path: a naive summary-only
 * swap would strand the how-to-fix / wait-hint remedy and leak the very rule the
 * maintainer set out to hide. The block-comment MODE only reshapes BLOCK
 * comments and only when no custom text is set; pass and human review carry no
 * reasons to trim. Every path ends with the hidden marker — the upsert lifecycle
 * (§7) depends on it.
 *
 * one-liner-link speaks ONE line per failed rule — never "plus N other
 * things"; hiding which rules fired is the exact confusion this mode exists to
 * avoid. custom renders the maintainer's template verbatim after var
 * substitution: no headline, no button — the template IS the body.
 */
export function renderVerdictComment(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy = OPEN_REDACTION,
): string {
	const override = commentOverrideFor(config, input.verdict);
	const customText = override.customText.trim();
	if (customText !== "") {
		const lines = [customText, ""];
		if (override.showDetailsButton) {
			lines.push(runButton(input), "");
		}
		lines.push(COMMENT_MARKER, "");
		return lines.join("\n");
	}
	const blockComment = config.blockComment;
	const level = redactionLevelFor(policy, "comment");
	if (input.verdict !== "block" || blockComment.mode === "full") {
		return renderCommentBody(input, override.showDetailsButton, policy);
	}
	if (blockComment.mode === "custom") {
		const body = renderTemplate(input, blockComment.template, level).trim();
		return [body, "", COMMENT_MARKER, ""].join("\n");
	}
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const reasonList = reasonSection(
		redactCommentReasons(input.reasons, level),
		(reasons) => reasons.map(oneLinerLine).join("\n\n"),
	);
	const lines: string[] = [headlineWithReasons(headline, reasonList), ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	if (override.showDetailsButton) {
		lines.push(runButton(input), "");
	}
	lines.push(COMMENT_MARKER, "");
	return lines.join("\n");
}
