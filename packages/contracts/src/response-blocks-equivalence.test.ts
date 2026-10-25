import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { AI_CREDITS_COPY } from "./ai-provider.ts";
import {
	type CommentInput,
	type CommentReason,
	changesLine,
	closeGifMarkdown,
	commentHeadline,
	howDoIFix,
	notesLine,
	REASON_LIMIT,
	RERUN_NOTE,
	REVIEW_PENDING,
	reasonsBlock,
	redactedReasonLine,
	renderSoleReview,
	renderVerdictComment,
	runButton,
} from "./comment-render.ts";
import {
	type RedactedReasons,
	reasonName,
	redactCommentReasons,
} from "./redact.ts";
import {
	REDACTION_MAX_LEVEL,
	type RedactionPolicy,
	type RedactionSurface,
	redactionLevelFor,
	redactionPolicySchema,
} from "./redaction.ts";
import {
	commentOverrideFor,
	type ResponseConfig,
	responseConfigSchema,
} from "./response.ts";
import { ruleContributorLabel } from "./rules.ts";
import type { Verdict } from "./runs.ts";

function asSentence(text: string): string {
	const trimmed = text.trim();
	const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
	return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_[\]<>]/g, "\\$&");
}

function oneLinerLine(reason: CommentReason): string {
	const label = reason.ruleId ? ruleContributorLabel(reason.ruleId) : null;
	const sentence = label
		? asSentence(label)
		: reason.hint
			? `${asSentence(reason.text)} ${asSentence(reason.hint)}`
			: asSentence(reason.text);
	return `**${escapeMarkdown(reasonName(reason))}:** ${sentence}`;
}

function oneLinerList(reasons: CommentReason[], limit: number): string {
	if (reasons.length <= 1) {
		return reasons[0] ? oneLinerLine(reasons[0]) : "";
	}
	const shown = reasons
		.slice(0, limit)
		.map((reason) => `- ${oneLinerLine(reason)}`);
	const rest = reasons.length - shown.length;
	return rest > 0
		? [...shown, `- And ${rest} more.`].join("\n")
		: shown.join("\n");
}

function legacyReasonSection(
	redacted: RedactedReasons,
	oneLiner: boolean,
	limit: number,
): string {
	if (redacted.kind !== "reasons") {
		return redactedReasonLine(redacted, limit);
	}
	return oneLiner
		? oneLinerList(redacted.reasons, limit)
		: reasonsBlock(redacted.reasons, limit);
}

function joinParagraphs(parts: (string | null | false)[]): string {
	return parts.filter((part): part is string => !!part).join("\n\n");
}

function legacyTemplate(input: CommentInput, template: string, level: number) {
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

function legacyBody(
	input: CommentInput,
	config: ResponseConfig,
	policy: RedactionPolicy,
	surface: Extract<RedactionSurface, "comment" | "review">,
): string {
	const override = commentOverrideFor(config, input.verdict, {
		notes: (input.notes ?? []).length > 0,
	});
	const button = override.showDetailsButton ? runButton(input.runUrl) : null;
	const customText = override.customText.trim();
	const gif = input.verdict === "close" ? closeGifMarkdown(config) : null;
	if (customText !== "") {
		return joinParagraphs([
			customText,
			input.aiReviewNotRun ? AI_CREDITS_COPY.notRunShort : null,
			button,
			gif,
		]);
	}
	const level = redactionLevelFor(policy, surface);
	const stopped = input.verdict === "block" || input.verdict === "close";
	if (input.verdict === "block" && config.blockComment.mode === "custom") {
		return legacyTemplate(input, config.blockComment.template, level).trim();
	}
	const oneLiner =
		input.verdict === "block" && config.blockComment.mode === "one-liner-link";
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
	const notes = notesLine(input.notes ?? []);
	const baseHeadline =
		input.verdict === "changes_required"
			? changesLine(input.fixes ?? [], input.reviewPending === true, level)
			: commentHeadline(input.verdict, input.contributorLogin, {
					degraded: input.degraded,
					previousVerdict: input.previousVerdict,
				});
	const headline =
		input.verdict === "pass" && notes
			? `${baseHeadline} ${notes}`
			: baseHeadline;
	const limit = button ? REASON_LIMIT : Number.POSITIVE_INFINITY;
	const detail = stopped
		? legacyReasonSection(
				redactCommentReasons(input.reasons, level),
				oneLiner,
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
		changes,
		input.verdict === "pass" ? null : notes,
		input.rerun ? RERUN_NOTE : null,
		button,
		help,
		gif,
	]);
}

const MARKER_TAIL = /\n\n<!-- tripwire:run -->\n$/;

const AGE: CommentReason = {
	text: "Your account is 2 days old.",
	remedy: "wait",
	hint: "This clears in 5 days.",
	ruleId: "account-age",
	ruleName: "Account age",
};
const CRYPTO: CommentReason = {
	text: "It adds 2 crypto wallet addresses to DONATE.md.",
	remedy: "revise",
	hint: "Remove the addresses.",
	ruleId: "crypto-address",
	ruleName: "Crypto address",
};
const CUSTOM: CommentReason = {
	text: "Target branch is main.",
	remedy: "revise",
	ruleId: "custom-doesnt-go-to-main-019fa6",
	ruleName: "Doesn't go to *main*",
};
const NAMELESS: CommentReason = { text: "something odd", remedy: "appeal" };

const REASON_SETS: CommentReason[][] = [
	[],
	[AGE],
	[AGE, CRYPTO, CUSTOM],
	[AGE, CRYPTO, CUSTOM, AGE, CRYPTO, CUSTOM, NAMELESS],
];

const INPUT_VARIANTS: Partial<CommentInput>[] = [
	{},
	{ degraded: true },
	{ previousVerdict: "block" },
	{ previousVerdict: "pass" },
	{ rerun: true, aiReviewNotRun: true },
	{ fixes: [{ message: "Change the target to main.", reasons: [] }] },
	{ fixes: [{ message: null, reasons: [CRYPTO] }], reviewPending: true },
	{ notes: ["No description provided.", "No description provided"] },
	{ reviewPending: true, notes: ["Docs only."] },
];

type ConfigInput = z.input<typeof responseConfigSchema>;

const GIF = {
	id: "abc123",
	url: "https://media.giphy.com/media/abc123/giphy.gif",
	width: 200,
	height: 120,
	title: "door (closing)",
};

const CONFIG_VARIANTS: ConfigInput[] = [
	{},
	{ onSuccess: "comment" },
	{
		blockComment: { showDetailsButton: false },
		passComment: { showDetailsButton: false },
		reviewComment: { showDetailsButton: false },
		changesRequiredComment: { showDetailsButton: false },
		noteComment: { showDetailsButton: false },
		closeComment: { showDetailsButton: false, gif: GIF },
	},
	{ blockComment: { mode: "one-liner-link" } },
	{ blockComment: { mode: "one-liner-link", showDetailsButton: false } },
	{
		blockComment: {
			mode: "custom",
			template: "blocked: {{ruleName}}\n\n{{runUrl}}",
		},
	},
	{
		blockComment: {
			mode: "custom",
			template: "  {{runUrl}}{{ruleName}}{{ruleName}} ",
		},
	},
	{ blockComment: { mode: "custom", template: "" } },
	{
		blockComment: { customText: " Thanks, we will look. " },
		passComment: { customText: "Looks good." },
		reviewComment: { customText: "A maintainer will look." },
		changesRequiredComment: { customText: "Please fix it." },
		noteComment: { customText: "Noted." },
		closeComment: { customText: "Closed for now.", gif: GIF },
	},
	{ closeComment: { gif: GIF }, onNote: "silent" },
];

const VERDICTS: Verdict[] = [
	"pass",
	"block",
	"changes_required",
	"needs_review",
	"close",
];

const POLICIES: RedactionPolicy[] = Array.from(
	{ length: REDACTION_MAX_LEVEL + 1 },
	(_, level) => level,
).flatMap((level) => [
	redactionPolicySchema.parse({ level }),
	redactionPolicySchema.parse({ level, showHelp: false }),
]);

describe("blocks derived from today's settings", () => {
	test("render byte-identical comments and reviews for every outcome", () => {
		let compared = 0;
		for (const verdict of VERDICTS) {
			for (const configInput of CONFIG_VARIANTS) {
				const config = responseConfigSchema.parse(configInput);
				for (const reasons of REASON_SETS) {
					for (const variant of INPUT_VARIANTS) {
						const input: CommentInput = {
							verdict,
							contributorLogin: "octocat",
							reasons,
							runUrl: "https://tripwire.sh/runs/0198abcd",
							...variant,
						};
						for (const policy of POLICIES) {
							expect(
								renderVerdictComment(input, config, policy).replace(
									MARKER_TAIL,
									"",
								),
							).toBe(legacyBody(input, config, policy, "comment"));
							expect(renderSoleReview(input, config, policy)).toBe(
								legacyBody(input, config, policy, "review"),
							);
							compared += 2;
						}
					}
				}
			}
		}
		expect(compared).toBe(
			VERDICTS.length *
				CONFIG_VARIANTS.length *
				REASON_SETS.length *
				INPUT_VARIANTS.length *
				POLICIES.length *
				2,
		);
	});
});
