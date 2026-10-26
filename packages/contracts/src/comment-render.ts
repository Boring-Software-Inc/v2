import { AI_CREDITS_COPY } from "./ai-provider.ts";
import {
	type RedactedReasons,
	reasonName,
	redactCommentReasons,
} from "./redact.ts";
import {
	OPEN_REDACTION,
	type RedactionItem,
	type RedactionPolicy,
	type RedactionSurface,
	redactionHides,
	redactionLevelFor,
} from "./redaction.ts";
import {
	blockOutcomeFor,
	type CloseGif,
	commentOverrideFor,
	DEFAULT_RESPONSE_CONFIG,
	isGiphyMediaUrl,
	type ResponseBlock,
	type ResponseBlockType,
	type ResponseConfig,
	type ResponseVariable,
	type TextPart,
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
export const REVIEW_PENDING = "Waiting for review.";

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
		return changesLine(
			issues.fixes ?? [],
			issues.reviewPending === true,
			level,
		);
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

export interface FixIssue {
	message: string | null;
	reasons: CommentReason[];
}

export interface OutcomeIssues {
	fixes?: FixIssue[];
	notes?: string[];
	reviewPending?: boolean;
}

export const FIX_FALLBACK = "Fix what this rule found.";

function uniqueSentences(lines: readonly string[]): string[] {
	return [...new Set(lines.map(asSentence))];
}

export function fixText(fix: FixIssue, level = 0): string {
	if (fix.message) {
		return fix.message;
	}
	const redacted = redactCommentReasons(fix.reasons, level);
	if (redacted.kind === "reasons" && redacted.reasons.length > 0) {
		return redacted.reasons.map((reason) => asSentence(reason.text)).join(" ");
	}
	if (redacted.kind !== "reasons") {
		const line = redactedReasonLine(redacted);
		if (line !== "") {
			return line;
		}
	}
	return FIX_FALLBACK;
}

export function changesLine(
	fixes: readonly FixIssue[],
	reviewPending: boolean,
	level = 0,
): string {
	return [
		CHANGES_NEEDED,
		...uniqueSentences(fixes.map((fix) => fixText(fix, level))),
		reviewPending ? REVIEW_PENDING : null,
	]
		.filter((part): part is string => part !== null)
		.join(" ");
}

export function notesLine(notes: readonly string[]): string | null {
	return notes.length === 0 ? null : uniqueSentences(notes).join(" ");
}

function issueTail(
	input: CommentInput,
	level: number,
): {
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
				? changesLine(fixes, reviewPending, level)
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
	title?: string;
	targetBranch?: string | null;
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

export type BlockViewer = "outsider" | "member";

export interface BlockLens {
	level: number;
	showHelp: boolean;
	viewer: BlockViewer;
}

export type BlockRenderSurface = Extract<
	RedactionSurface,
	"comment" | "review"
>;

export const BLOCK_HIDDEN_AT: Partial<
	Record<ResponseBlockType, RedactionItem>
> = { "failed-rules": "failed-count" };

export const VARIABLE_HIDDEN_AT: Partial<
	Record<ResponseVariable, RedactionItem>
> = { "failed-rules": "rule-names", "rule-name": "rule-names" };

export function lensLevel(lens: BlockLens): number {
	return lens.viewer === "member" ? 0 : lens.level;
}

export function blockHidden(block: ResponseBlock, lens: BlockLens): boolean {
	if (lens.viewer === "member") {
		return false;
	}
	if (block.type === "help" && !lens.showHelp) {
		return true;
	}
	const item = BLOCK_HIDDEN_AT[block.type];
	return item !== undefined && redactionHides(lens.level, item);
}

export function variableHidden(
	name: ResponseVariable,
	lens: BlockLens,
): boolean {
	const item = VARIABLE_HIDDEN_AT[name];
	return item !== undefined && redactionHides(lensLevel(lens), item);
}

function plainInline(text: string): string {
	return escapeMarkdown(text).replaceAll("@", "@​");
}

function firstRuleName(input: CommentInput, level: number): string {
	const redacted = redactCommentReasons(input.reasons, level);
	if (redacted.kind === "count" || redacted.kind === "verdict") {
		return "";
	}
	if (redacted.kind === "names") {
		return redacted.names[0] ?? "";
	}
	const first = input.reasons[0];
	return (
		(first?.ruleId ? ruleContributorLabel(first.ruleId) : null) ??
		redacted.reasons[0]?.text ??
		""
	);
}

export const FAILED_RULES_HIDDEN = "some rules";

function failedRuleNames(input: CommentInput, level: number): string {
	const count = input.reasons.length;
	if (count === 0) {
		return "";
	}
	if (redactionHides(level, "failed-count")) {
		return FAILED_RULES_HIDDEN;
	}
	if (redactionHides(level, "rule-names")) {
		return `${count} ${count === 1 ? "rule" : "rules"}`;
	}
	return listNames(input.reasons.map(reasonName).map(escapeMarkdown));
}

export function variableText(
	name: ResponseVariable,
	input: CommentInput,
	level: number,
): string {
	switch (name) {
		case "author":
			return `@${input.contributorLogin}`;
		case "failed-rules":
			return failedRuleNames(input, level);
		case "rule-name":
			return firstRuleName(input, level);
		case "run-link":
			return runButton(input.runUrl);
		case "title":
			return plainInline(input.title ?? "");
		case "target-branch":
			return plainInline(input.targetBranch ?? "");
	}
}

function headlineText(input: CommentInput, level: number): string {
	if (input.verdict === "changes_required") {
		return changesLine(input.fixes ?? [], input.reviewPending === true, level);
	}
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const notes = notesLine(input.notes ?? []);
	return input.verdict === "pass" && notes ? `${headline} ${notes}` : headline;
}

function blockBody(
	block: ResponseBlock,
	input: CommentInput,
	level: number,
	reasonLimit: number,
): string {
	switch (block.type) {
		case "headline":
			return headlineText(input, level);
		case "verdict-line":
			return checkSummary(
				input.verdict,
				input.reasons,
				input.degraded,
				level,
				false,
				input,
			);
		case "instruction":
			return issueTail(input, level).changes ?? "";
		case "text":
			return block.parts
				.map((part) =>
					part.kind === "text"
						? part.text
						: variableText(part.name, input, level),
				)
				.join("")
				.trim();
		case "failed-rules":
			return reasonSection(
				redactCommentReasons(input.reasons, level),
				block.style === "one-liner" ? oneLinerLine : reasonLine,
				reasonLimit,
			);
		case "notes":
			return input.verdict === "pass"
				? ""
				: (issueTail(input, level).notes ?? "");
		case "ai-notice":
			return input.aiReviewNotRun ? AI_CREDITS_COPY.notRunShort : "";
		case "rerun-notice":
			return input.rerun ? RERUN_NOTE : "";
		case "run-link":
			return runButton(input.runUrl);
		case "help":
			return howDoIFix(input.reasons, level);
		case "gif":
			return gifMarkdown(block.gif) ?? "";
	}
}

export interface BlockOutput {
	block: ResponseBlock;
	body: string | null;
}

export function renderBlockOutputs(
	blocks: readonly ResponseBlock[],
	input: CommentInput,
	lens: BlockLens,
): BlockOutput[] {
	const level = lensLevel(lens);
	const reasonLimit = blocks.some((block) => block.type === "run-link")
		? REASON_LIMIT
		: Number.POSITIVE_INFINITY;
	return blocks.map((block) => ({
		block,
		body: blockHidden(block, lens)
			? null
			: blockBody(block, input, level, reasonLimit),
	}));
}

export function renderBlocks(
	blocks: readonly ResponseBlock[],
	input: CommentInput,
	lens: BlockLens,
): string {
	return joinParagraphs(
		renderBlockOutputs(blocks, input, lens).map((output) => output.body),
	);
}

const TEMPLATE_TOKENS: readonly [string, ResponseVariable][] = [
	["{{ruleName}}", "rule-name"],
	["{{runUrl}}", "run-link"],
];

function templateParts(template: string): TextPart[] {
	const parts: TextPart[] = [];
	let rest = template;
	while (rest !== "") {
		const next = TEMPLATE_TOKENS.map(([token, name]) => ({
			token,
			name,
			index: rest.indexOf(token),
		}))
			.filter((hit) => hit.index !== -1)
			.sort((a, b) => a.index - b.index)[0];
		if (!next) {
			parts.push({ kind: "text", text: rest });
			break;
		}
		if (next.index > 0) {
			parts.push({ kind: "text", text: rest.slice(0, next.index) });
		}
		parts.push({ kind: "var", name: next.name });
		rest = rest.slice(next.index + next.token.length);
	}
	return parts;
}

export interface DefaultBlockOptions {
	notes?: boolean;
	surface?: BlockRenderSurface;
}

export function defaultBlocks(
	config: ResponseConfig,
	verdict: Verdict,
	options: DefaultBlockOptions = {},
): ResponseBlock[] {
	const override = commentOverrideFor(config, verdict, options);
	const link: ResponseBlock[] = override.showDetailsButton
		? [{ id: "run-link", type: "run-link" }]
		: [];
	const gif: ResponseBlock[] =
		verdict === "close" && config.closeComment.gif
			? [{ id: "gif", type: "gif", gif: config.closeComment.gif }]
			: [];
	const customText = override.customText.trim();
	if (customText !== "") {
		return [
			{ id: "text", type: "text", parts: [{ kind: "text", text: customText }] },
			{ id: "ai-notice", type: "ai-notice" },
			...link,
			...gif,
		];
	}
	if (verdict === "block" && config.blockComment.mode === "custom") {
		return [
			{
				id: "text",
				type: "text",
				parts: templateParts(config.blockComment.template),
			},
		];
	}
	const oneLiner =
		verdict === "block" && config.blockComment.mode === "one-liner-link";
	const stopped: ResponseBlock[] =
		verdict === "block" || verdict === "close"
			? [
					{
						id: "failed-rules",
						type: "failed-rules",
						style: oneLiner ? "one-liner" : "full",
					},
				]
			: [];
	const help: ResponseBlock[] =
		verdict === "block" && (!oneLiner || options.surface === "review")
			? [{ id: "help", type: "help" }]
			: [];
	return [
		{ id: "headline", type: "headline" },
		{ id: "ai-notice", type: "ai-notice" },
		...stopped,
		{ id: "instruction", type: "instruction" },
		{ id: "notes", type: "notes" },
		{ id: "rerun-notice", type: "rerun-notice" },
		...link,
		...help,
		...gif,
	];
}

export function blocksFor(
	config: ResponseConfig,
	verdict: Verdict,
	options: DefaultBlockOptions = {},
): ResponseBlock[] {
	const outcome = blockOutcomeFor(config, verdict, options);
	return (
		(outcome ? config.blocks[outcome] : undefined) ??
		defaultBlocks(config, verdict, options)
	);
}

function renderBody(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy,
	surface: BlockRenderSurface,
): string {
	const notes = (input.notes ?? []).length > 0;
	return renderBlocks(
		blocksFor(config, input.verdict, { notes, surface }),
		input,
		{
			level: redactionLevelFor(policy, surface),
			showHelp: policy.showHelp,
			viewer: "outsider",
		},
	);
}

function gifAlt(title: string): string {
	return title.replace(/[\\[\]\n\r]/g, " ").trim() || "GIF";
}

export function gifMarkdown(gif: CloseGif | null): string | null {
	if (!gif || !isGiphyMediaUrl(gif.url)) {
		return null;
	}
	const href = new URL(gif.url).href
		.replaceAll("(", "%28")
		.replaceAll(")", "%29");
	return `![${gifAlt(gif.title)}](${href})`;
}

export function closeGifMarkdown(config: ResponseConfig): string | null {
	return gifMarkdown(config.closeComment.gif);
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
		closeComment: { ...override, gif: null },
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
	const level = redactionLevelFor(policy, "comment");
	const stored = config.blocks.block;
	if (stored) {
		return (
			stored.length > 0 &&
			(!redactionHides(level, "reasons") ||
				stored.some((block) => DETAIL_BLOCKS.has(block.type)))
		);
	}
	if (
		config.blockComment.customText.trim() !== "" ||
		config.blockComment.mode === "custom"
	) {
		return true;
	}
	return !redactionHides(level, "reasons");
}

const DETAIL_BLOCKS: ReadonlySet<ResponseBlockType> = new Set([
	"text",
	"verdict-line",
	"instruction",
	"notes",
	"gif",
]);

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
