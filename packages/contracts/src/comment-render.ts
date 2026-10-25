import { AI_CREDITS_COPY } from "./ai-provider.ts";
import {
	type RedactedReasons,
	reasonName,
	redactCommentReasons,
} from "./redact.ts";
import {
	OPEN_REDACTION,
	type RedactionPolicy,
	type RedactionSurface,
	redactionHides,
	redactionLevelFor,
} from "./redaction.ts";
import {
	commentOverrideFor,
	DEFAULT_RESPONSE_CONFIG,
	type ResponseConfig,
	wantsComment,
} from "./response.ts";
import { ruleContributorLabel } from "./rules.ts";
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
 */

/** The verdict as a bare word — the bold line and the check summary. */
export const VERDICT_WORD: Record<Verdict, string> = {
	pass: "passed",
	block: "blocked",
	changes_required: "changes needed",
	needs_review: "human review",
	close: "closed",
};

/** What a contributor can do about a blocking rule — mirrors core's rule field. */
export type Remedy = "revise" | "wait" | "appeal";

/** One failing rule as the comment speaks it: its one-liner + how to clear it. */
export interface CommentReason {
	/** The rule's summarize() one-liner (§10). */
	text: string;
	remedy: Remedy;
	/** A derived, threshold-free next step: "This clears in 5 days." */
	hint?: string | null;
	/** Bare rule id ("account-age"). */
	ruleId?: string;
	ruleName?: string;
	stepId?: string;
}

export interface HeadlineOptions {
	degraded?: boolean;
	/**
	 * The verdict the ACTIVE comment already shows. When it differs from the new
	 * verdict this comment is a RESOLUTION (§7). null/undefined ⇒ first-time
	 * verdict.
	 */
	previousVerdict?: Verdict | null;
}

export function commentHeadline(
	verdict: Verdict,
	login: string,
	options: HeadlineOptions = {},
): string {
	const { degraded = false, previousVerdict = null } = options;
	const transition = previousVerdict !== null && previousVerdict !== verdict;

	if (verdict === "pass") {
		return transition
			? `@${login}, Tripwire now passes this change request.`
			: "Tripwire passed this change request.";
	}
	if (verdict === "changes_required") {
		return CHANGES_NEEDED;
	}
	if (verdict === "close") {
		return CLOSED;
	}
	if (verdict === "needs_review") {
		if (degraded) {
			return `@${login}, Tripwire could not finish checking this change request, so it needs human review. A maintainer will approve or block it.`;
		}
		return transition && previousVerdict === "block"
			? `@${login}, Tripwire no longer blocks this change request, but it needs human review. A maintainer will approve or block it.`
			: `@${login}, this change request needs human review. A maintainer will approve or block it.`;
	}
	return transition
		? `@${login}, Tripwire now blocks this change request.`
		: `@${login}, Tripwire blocked this change request.`;
}

export const CHANGES_NEEDED = "Changes needed.";
export const CLOSED = "Closed.";
export const REVIEW_PENDING = "Human review is pending.";

export const RERUN_NOTE = "Tripwire checked this again with the current rules.";

function capitalize(text: string): string {
	const trimmed = text.trim();
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function asSentence(text: string): string {
	const capitalized = capitalize(text);
	return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_[\]<>]/g, "\\$&");
}

function sentenceWithHint(text: string, hint?: string | null): string {
	return hint ? `${asSentence(text)} ${asSentence(hint)}` : asSentence(text);
}

function labelled(reason: CommentReason, sentence: string): string {
	return `**${escapeMarkdown(reasonName(reason))}:** ${sentence}`;
}

function reasonLine(reason: CommentReason): string {
	return labelled(reason, sentenceWithHint(reason.text, reason.hint));
}

function oneLinerLine(reason: CommentReason): string {
	const label = reason.ruleId ? ruleContributorLabel(reason.ruleId) : null;
	return label
		? labelled(reason, asSentence(label))
		: labelled(reason, sentenceWithHint(reason.text, reason.hint));
}

export const REASON_LIMIT = 5;

function moreLine(count: number): string {
	return `And ${count} more.`;
}

function reasonList(
	reasons: CommentReason[],
	line: (reason: CommentReason) => string,
	limit: number,
): string {
	if (reasons.length <= 1) {
		return reasons[0] ? line(reasons[0]) : "";
	}
	const shown = reasons.slice(0, limit).map((reason) => `- ${line(reason)}`);
	const rest = reasons.length - shown.length;
	return rest > 0
		? [...shown, `- ${moreLine(rest)}`].join("\n")
		: shown.join("\n");
}

export function reasonsBlock(
	reasons: CommentReason[],
	limit = REASON_LIMIT,
): string {
	return reasonList(reasons, reasonLine, limit);
}

const APPEAL_WRONG =
	"If you think this is wrong, say so in a comment. A maintainer will decide.";
const APPEAL_ANYWAY =
	"If you think it should merge anyway, say so in a comment. A maintainer will decide.";
const FIX_REVISE = `Push a commit that fixes the problems. Tripwire checks every push.\n\n${APPEAL_WRONG}`;
const FIX_NONE = `A new commit will not fix this.\n\n${APPEAL_ANYWAY}`;
const FIX_MIXED = `Fix what you can and push. Some problems will not clear with a new commit.\n\n${APPEAL_ANYWAY}`;
const FIX_HIDDEN = `Push a new commit to run the checks again.\n\n${APPEAL_WRONG}`;

function fixBody(reasons: CommentReason[], level: number): string {
	if (redactionHides(level, "rule-names")) {
		return FIX_HIDDEN;
	}
	const anyRevise = reasons.some((r) => r.remedy === "revise");
	const anyNonRevise = reasons.some((r) => r.remedy !== "revise");
	return anyRevise ? (anyNonRevise ? FIX_MIXED : FIX_REVISE) : FIX_NONE;
}

export function howDoIFix(reasons: CommentReason[], level = 0): string {
	const body = fixBody(reasons, level);
	return `<details><summary>How do I fix this?</summary>\n\n${body}\n</details>`;
}

export const RUN_LINK_TEXT = "View on Tripwire";
export const BADGE_PATH = "/badges/view-run.png";
export const BADGE_WIDTH = 185;

export const CHECK_NAME = "tripwire";

export const REVIEW_POINTER = {
	block: "Blocked. See the comment.",
	needs_review: "Needs human review. See the comment.",
} as const satisfies Partial<Record<Verdict, string>>;

function listNames(names: string[], limit = REASON_LIMIT): string {
	const shown = names.slice(0, limit);
	const rest = names.length - shown.length;
	if (rest > 0) {
		return `${shown.join(", ")} and ${rest} more`;
	}
	if (shown.length <= 1) {
		return shown[0] ?? "";
	}
	return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

export function redactedReasonLine(
	redacted: Exclude<RedactedReasons, { kind: "reasons" }>,
	limit = REASON_LIMIT,
): string {
	if (redacted.kind === "names") {
		const count = redacted.names.length;
		if (count === 0) {
			return "";
		}
		const list = listNames(redacted.names.map(escapeMarkdown), limit);
		return count === 1
			? `This rule did not pass: ${list}.`
			: `${count} rules did not pass: ${list}.`;
	}
	if (redacted.kind === "count") {
		if (redacted.count === 0) {
			return "";
		}
		return `${redacted.count} ${redacted.count === 1 ? "rule" : "rules"} did not pass.`;
	}
	return "";
}

export function checkSummary(
	verdict: Verdict,
	reasons: CommentReason[],
	degraded = false,
	level = 0,
	aiReviewNotRun = false,
	issues: OutcomeIssues = {},
): string {
	const summary = verdictCheckSummary(
		verdict,
		reasons,
		degraded,
		level,
		issues,
	);
	return aiReviewNotRun ? `${summary} ${AI_CREDITS_COPY.notRunShort}` : summary;
}

function stoppedSummary(
	word: "Blocked" | "Closed",
	reasons: CommentReason[],
	level: number,
): string {
	if (reasons.length === 0 || redactionHides(level, "failed-count")) {
		return `${word}.`;
	}
	if (redactionHides(level, "rule-names")) {
		return `${word} by ${reasons.length} ${reasons.length === 1 ? "rule" : "rules"}.`;
	}
	return `${word} by ${listNames(reasons.map(reasonName))}.`;
}

function verdictCheckSummary(
	verdict: Verdict,
	reasons: CommentReason[],
	degraded: boolean,
	level: number,
	issues: OutcomeIssues,
): string {
	if (verdict === "block") {
		return stoppedSummary("Blocked", reasons, level);
	}
	if (verdict === "close") {
		return stoppedSummary("Closed", reasons, level);
	}
	if (verdict === "changes_required") {
		return changesLine(issues.fixes ?? [], issues.reviewPending === true);
	}
	if (verdict === "needs_review") {
		return degraded
			? "Waiting for human review. Tripwire could not finish checking."
			: "Waiting for human review.";
	}
	return "Passed.";
}

export const COMMENT_MARKER = "<!-- tripwire:run -->";

export const TRIPWIRE_MARKER_PREFIX = "<!-- tripwire:";

export function actionCommentMarker(input: {
	workflowId: string;
	nodeId: string;
	runId: string;
}): string {
	return `<!-- tripwire:comment ${input.workflowId}/${input.nodeId} run=${input.runId} -->`;
}

export function isTripwireComment(body: string): boolean {
	return body.includes(COMMENT_MARKER) || body.includes(TRIPWIRE_MARKER_PREFIX);
}

export interface OutcomeIssues {
	fixes?: string[];
	notes?: string[];
	reviewPending?: boolean;
}

function uniqueSentences(lines: readonly string[]): string[] {
	return [...new Set(lines.map(asSentence))];
}

export function changesLine(
	fixes: readonly string[],
	reviewPending: boolean,
): string {
	return [
		CHANGES_NEEDED,
		...uniqueSentences(fixes),
		reviewPending ? REVIEW_PENDING : null,
	]
		.filter((part): part is string => part !== null)
		.join(" ");
}

export function notesLine(notes: readonly string[]): string | null {
	return notes.length === 0 ? null : uniqueSentences(notes).join(" ");
}

function issueTail(input: CommentInput): {
	changes: string | null;
	notes: string | null;
} {
	const fixes = input.fixes ?? [];
	const reviewPending =
		input.reviewPending === true && input.verdict !== "needs_review";
	const changes =
		input.verdict === "changes_required"
			? null
			: fixes.length > 0
				? changesLine(fixes, reviewPending)
				: reviewPending
					? REVIEW_PENDING
					: null;
	return { changes, notes: notesLine(input.notes ?? []) };
}

export interface CommentInput extends OutcomeIssues {
	verdict: Verdict;
	contributorLogin: string;
	reasons: CommentReason[];
	runUrl: string;
	degraded?: boolean;
	previousVerdict?: Verdict | null;
	rerun?: boolean;
	aiReviewNotRun?: boolean;
}

export function badgeUrl(runUrl: string): string {
	try {
		return new URL(BADGE_PATH, runUrl).href;
	} catch {
		return BADGE_PATH;
	}
}

export function runButton(runUrl: string): string {
	return `<a href="${runUrl}"><img src="${badgeUrl(runUrl)}" width="${BADGE_WIDTH}" alt="${RUN_LINK_TEXT}" /></a>`;
}

function reasonSection(
	redacted: RedactedReasons,
	line: (reason: CommentReason) => string,
	limit: number,
): string {
	return redacted.kind === "reasons"
		? reasonList(redacted.reasons, line, limit)
		: redactedReasonLine(redacted, limit);
}

function joinParagraphs(parts: (string | null | false)[]): string {
	return parts.filter((part): part is string => !!part).join("\n\n");
}

function renderTemplate(
	input: CommentInput,
	template: string,
	level: number,
): string {
	const redacted = redactCommentReasons(input.reasons, level);
	const first = input.reasons[0];
	const ruleName =
		redacted.kind === "count" || redacted.kind === "verdict"
			? ""
			: redacted.kind === "names"
				? (redacted.names[0] ?? "")
				: ((first?.ruleId ? ruleContributorLabel(first.ruleId) : null) ??
					redacted.reasons[0]?.text ??
					"");
	return template
		.replaceAll("{{ruleName}}", ruleName)
		.replaceAll("{{runUrl}}", runButton(input.runUrl));
}

function renderBody(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy,
	surface: Extract<RedactionSurface, "comment" | "review">,
): string {
	const hasNotes = (input.notes ?? []).length > 0;
	const override = commentOverrideFor(config, input.verdict, {
		notes: hasNotes,
	});
	const button = override.showDetailsButton ? runButton(input.runUrl) : null;
	const customText = override.customText.trim();
	if (customText !== "") {
		return joinParagraphs([
			customText,
			input.aiReviewNotRun ? AI_CREDITS_COPY.notRunShort : null,
			button,
		]);
	}
	const level = redactionLevelFor(policy, surface);
	const stopped = input.verdict === "block" || input.verdict === "close";
	if (input.verdict === "block" && config.blockComment.mode === "custom") {
		return renderTemplate(input, config.blockComment.template, level).trim();
	}
	const oneLiner = stopped && config.blockComment.mode === "one-liner-link";
	const tail = issueTail(input);
	const baseHeadline =
		input.verdict === "changes_required"
			? changesLine(input.fixes ?? [], input.reviewPending === true)
			: commentHeadline(input.verdict, input.contributorLogin, {
					degraded: input.degraded,
					previousVerdict: input.previousVerdict,
				});
	const headline =
		input.verdict === "pass" && tail.notes
			? `${baseHeadline} ${tail.notes}`
			: baseHeadline;
	const limit = button ? REASON_LIMIT : Number.POSITIVE_INFINITY;
	const detail = stopped
		? reasonSection(
				redactCommentReasons(input.reasons, level),
				oneLiner ? oneLinerLine : reasonLine,
				limit,
			)
		: "";
	const help =
		input.verdict === "block" &&
		policy.showHelp &&
		(!oneLiner || surface === "review")
			? howDoIFix(input.reasons, level)
			: null;
	return joinParagraphs([
		headline,
		input.aiReviewNotRun ? AI_CREDITS_COPY.notRunShort : null,
		detail,
		tail.changes,
		input.verdict === "pass" ? null : tail.notes,
		input.rerun ? RERUN_NOTE : null,
		button,
		help,
	]);
}

function withMarker(body: string): string {
	return `${body}\n\n${COMMENT_MARKER}\n`;
}

export function renderCommentBody(
	input: CommentInput,
	showRunLink = true,
	policy: RedactionPolicy = OPEN_REDACTION,
): string {
	const override = { customText: "", showDetailsButton: showRunLink };
	const config: ResponseConfig = {
		...DEFAULT_RESPONSE_CONFIG,
		passComment: override,
		blockComment: { ...override, mode: "full", template: "" },
		reviewComment: override,
		changesRequiredComment: override,
		noteComment: override,
	};
	return withMarker(renderBody(input, config, policy, "comment"));
}

export interface ClosedCommentInput {
	contributorLogin: string | null;
	runUrl: string;
	showRunLink: boolean;
}

export function renderClosedBeforeReviewComment(
	input: ClosedCommentInput,
): string {
	const headline = input.contributorLogin
		? `@${input.contributorLogin}, this change request closed before review.`
		: "This change request closed before review.";
	return withMarker(
		joinParagraphs([
			headline,
			input.showRunLink ? runButton(input.runUrl) : null,
		]),
	);
}

export function renderVerdictComment(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy = OPEN_REDACTION,
): string {
	return withMarker(renderBody(input, config, policy, "comment"));
}

export function renderSoleReview(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy = OPEN_REDACTION,
): string {
	return renderBody(input, config, policy, "review");
}

export function blockCommentAddsDetail(
	config: ResponseConfig,
	policy: RedactionPolicy,
): boolean {
	if (
		config.blockComment.customText.trim() !== "" ||
		config.blockComment.mode === "custom"
	) {
		return true;
	}
	return !redactionHides(redactionLevelFor(policy, "comment"), "reasons");
}

export type CommentPlan = "upsert" | "if-present" | "delete" | "none";

export interface SurfacePlan {
	comment: CommentPlan;
	commentBody: string | null;
	review: string | null;
}

export interface SurfacePlanOptions {
	reviewPosted: boolean;
}

export function planSurfaces(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy,
	options: SurfacePlanOptions,
): SurfacePlan {
	const { verdict } = input;
	const previous = input.previousVerdict ?? null;
	const transition = previous !== null && previous !== verdict;
	const wanted = wantsComment(config, verdict, {
		notes: (input.notes ?? []).length > 0,
	});
	const reviewPosted = options.reviewPosted && verdict !== "pass";
	const sole = () => renderSoleReview(input, config, policy);
	const body = () => renderVerdictComment(input, config, policy);

	if (verdict === "block" && reviewPosted) {
		if (wanted && blockCommentAddsDetail(config, policy)) {
			return {
				comment: "upsert",
				commentBody: body(),
				review: REVIEW_POINTER.block,
			};
		}
		return { comment: "delete", commentBody: null, review: sole() };
	}
	if (wanted) {
		return {
			comment: "upsert",
			commentBody: body(),
			review:
				reviewPosted && verdict === "needs_review"
					? REVIEW_POINTER.needs_review
					: null,
		};
	}
	return {
		comment: transition ? "if-present" : "none",
		commentBody: transition ? body() : null,
		review: reviewPosted ? sole() : null,
	};
}
