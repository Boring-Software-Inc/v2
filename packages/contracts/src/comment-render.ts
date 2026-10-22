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
export const RERUN_NOTE = "Checked again with the current rules.";

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

export const REASON_LIMIT = 5;

export function reasonsBlock(
	reasons: CommentReason[],
	limit = REASON_LIMIT,
): string {
	if (reasons.length <= 1) {
		return reasons[0] ? reasonLine(reasons[0]) : "";
	}
	return reasons
		.slice(0, limit)
		.map((reason) => `- ${reasonLine(reason)}`)
		.join("\n");
}

function headlineWithReasons(headline: string, reasonList: string): string {
	return reasonList === "" ? headline : `${headline}\n\n${reasonList}`;
}

const APPEAL_WRONG =
	"If this is wrong, say so in a comment. A maintainer will decide.";
const APPEAL_ANYWAY =
	"If it should merge anyway, say so in a comment. A maintainer will decide.";
const FIX_REVISE = `Fix the problems and push. Tripwire checks every push.\n\n${APPEAL_WRONG}`;
const FIX_NONE = `A new commit will not fix this.\n\n${APPEAL_ANYWAY}`;
const FIX_MIXED = `Fix what you can and push. Some problems will not clear with a new commit.\n\n${APPEAL_ANYWAY}`;

export function howDoIFix(reasons: CommentReason[]): string {
	const anyRevise = reasons.some((r) => r.remedy === "revise");
	const anyNonRevise = reasons.some((r) => r.remedy !== "revise");
	const body = anyRevise ? (anyNonRevise ? FIX_MIXED : FIX_REVISE) : FIX_NONE;
	return `<details><summary>How do I fix this?</summary>\n\n${body}\n</details>`;
}

export const RUN_LINK_TEXT = "View on Tripwire";

export const CHECK_NAME = "tripwire";

export const REVIEW_BODY = "Blocked. See the comment.";
export const REVIEW_BODY_NO_COMMENT = "Blocked. See the tripwire check.";

export function reviewBody(commentPosted: boolean): string {
	return commentPosted ? REVIEW_BODY : REVIEW_BODY_NO_COMMENT;
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
		return `It did not meet ${redacted.count} ${redacted.count === 1 ? "rule" : "rules"}.`;
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
			? "Waiting for human review. Tripwire could not finish checking."
			: "Waiting for human review.";
	}
	return "Passed.";
}

export const COMMENT_MARKER = "<!-- tripwire:run -->";

export interface CommentInput {
	verdict: Verdict;
	contributorLogin: string;
	reasons: CommentReason[];
	runUrl: string;
	degraded?: boolean;
	previousVerdict?: Verdict | null;
	rerun?: boolean;
}

function runLink(runUrl: string, text = RUN_LINK_TEXT): string {
	return `<a href="${runUrl}">${text}</a>`;
}

function reasonSection(
	redacted: RedactedReasons,
	line: (reasons: CommentReason[]) => string,
): string {
	return redacted.kind === "reasons"
		? line(redacted.reasons)
		: redactedReasonLine(redacted);
}

function cappedReasonTotal(redacted: RedactedReasons, limit: number): number {
	return redacted.kind === "reasons" && redacted.reasons.length > limit
		? redacted.reasons.length
		: 0;
}

export function renderCommentBody(
	input: CommentInput,
	showRunLink = true,
	policy: RedactionPolicy = OPEN_REDACTION,
): string {
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const block = input.verdict === "block";
	const redacted = redactCommentReasons(
		block ? input.reasons : [],
		redactionLevelFor(policy, "comment"),
	);
	const limit = showRunLink ? REASON_LIMIT : Number.POSITIVE_INFINITY;
	const reasonList = block
		? reasonSection(redacted, (reasons) => reasonsBlock(reasons, limit))
		: "";
	const lines: string[] = [headlineWithReasons(headline, reasonList), ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	if (showRunLink) {
		const total = cappedReasonTotal(redacted, limit);
		lines.push(
			runLink(
				input.runUrl,
				total > 0 ? `View all ${total} reasons on Tripwire` : RUN_LINK_TEXT,
			),
			"",
		);
	}
	if (block && policy.showHelp) {
		lines.push(howDoIFix(input.reasons));
	}
	lines.push(COMMENT_MARKER, "");
	return lines.join("\n");
}

function oneLinerLine(reason: CommentReason): string {
	const label =
		(reason.ruleId ? ruleContributorLabel(reason.ruleId) : null) ??
		reasonLine(reason);
	return reason.ruleId
		? `${capitalize(ruleDisplayName(reason.ruleId))}: ${asSentence(label)}`
		: asSentence(label);
}

function oneLinerList(reasons: CommentReason[]): string {
	return reasons.length === 1
		? oneLinerLine(reasons[0] as CommentReason)
		: reasons.map((reason) => `- ${oneLinerLine(reason)}`).join("\n");
}

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
		.replaceAll("{{runUrl}}", runLink(input.runUrl));
}

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
			lines.push(runLink(input.runUrl), "");
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
		oneLinerList,
	);
	const lines: string[] = [headlineWithReasons(headline, reasonList), ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	if (override.showDetailsButton) {
		lines.push(runLink(input.runUrl), "");
	}
	lines.push(COMMENT_MARKER, "");
	return lines.join("\n");
}
