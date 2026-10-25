import type {
	BlockCommentMode,
	CloseGif,
	CommentInput,
	CommentReason,
	RedactionPolicy,
	ResponseConfig,
	SurfacePlan,
	Verdict,
} from "@tripwire/contracts";
import {
	checkSummary,
	closeGifSchema,
	planSurfaces,
	redactionLevelFor,
	responseConfigSchema,
	wantsCheck,
	wantsComment,
} from "@tripwire/contracts";
import { z } from "zod";
import {
	decodeSurfaces,
	encodeSurfaces,
} from "#/components/responses/redaction-model";
import type { SaveQueueCommit } from "#/components/save-queue";

export type OutcomeScope =
	| "block"
	| "changes_required"
	| "needs_review"
	| "note"
	| "close";

export type CommentSurfaceKey =
	| "onBlock"
	| "onChangesRequired"
	| "moderationQueued"
	| "onNote"
	| "onClose";

export type OverrideKey =
	| "blockComment"
	| "changesRequiredComment"
	| "reviewComment"
	| "noteComment"
	| "closeComment";

export interface OutcomeMeta {
	value: OutcomeScope;
	label: string;
	verdict: Verdict;
	surface: CommentSurfaceKey;
	override: OverrideKey;
	editable: boolean;
	edited: boolean;
}

const BLOCK_OUTCOME: OutcomeMeta = {
	value: "block",
	label: "Block",
	verdict: "block",
	surface: "onBlock",
	override: "blockComment",
	editable: false,
	edited: false,
};

export const OUTCOMES: readonly OutcomeMeta[] = [
	BLOCK_OUTCOME,
	{
		value: "changes_required",
		label: "Ask author to fix",
		verdict: "changes_required",
		surface: "onChangesRequired",
		override: "changesRequiredComment",
		editable: true,
		edited: true,
	},
	{
		value: "needs_review",
		label: "Human review",
		verdict: "needs_review",
		surface: "moderationQueued",
		override: "reviewComment",
		editable: true,
		edited: false,
	},
	{
		value: "note",
		label: "Note only",
		verdict: "pass",
		surface: "onNote",
		override: "noteComment",
		editable: false,
		edited: false,
	},
	{
		value: "close",
		label: "Close",
		verdict: "close",
		surface: "onClose",
		override: "closeComment",
		editable: true,
		edited: false,
	},
];

export function outcomeMeta(scope: OutcomeScope): OutcomeMeta {
	return OUTCOMES.find((outcome) => outcome.value === scope) ?? BLOCK_OUTCOME;
}

export const SAMPLE_FIX = "Change the target to main.";
export const SAMPLE_NOTE = "No description provided.";

export const SAMPLE_REASONS: CommentReason[] = [
	{
		text: "Your account is 2 days old.",
		remedy: "wait",
		hint: "This clears in 5 days.",
		ruleId: "account-age",
		ruleName: "Account age",
	},
	{
		text: "It adds 2 crypto wallet addresses to DONATE.md.",
		remedy: "revise",
		hint: "Remove the addresses.",
		ruleId: "crypto-address",
		ruleName: "Crypto address",
	},
];

const CLOSE_REASONS: CommentReason[] = SAMPLE_REASONS.slice(0, 1);

const TEMPLATE_PLACEHOLDER = "blocked: {{ruleName}}\n\n{{runUrl}}";

const ENCODED_SURFACES = z.string();

export type ContentChoice = Exclude<BlockCommentMode, "custom"> | "message";

export type DraftKey =
	| "blockComment.customText"
	| "blockComment.template"
	| "changesRequiredComment.customText"
	| "reviewComment.customText"
	| "closeComment.customText";

export function encodeGif(gif: CloseGif | null): string {
	return gif ? JSON.stringify(gif) : "";
}

export function decodeGif(value: unknown): CloseGif | null {
	if (typeof value !== "string" || value === "") {
		return null;
	}
	try {
		const parsed = closeGifSchema.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function flattenConfig(config: ResponseConfig) {
	return {
		onSuccess: config.onSuccess,
		onBlock: config.onBlock,
		moderationQueued: config.moderationQueued,
		"blockComment.mode": config.blockComment.mode,
		"blockComment.template": config.blockComment.template,
		"passComment.customText": config.passComment.customText,
		"passComment.showDetailsButton": config.passComment.showDetailsButton,
		"blockComment.customText": config.blockComment.customText,
		"blockComment.showDetailsButton": config.blockComment.showDetailsButton,
		"reviewComment.customText": config.reviewComment.customText,
		"reviewComment.showDetailsButton": config.reviewComment.showDetailsButton,
		onChangesRequired: config.onChangesRequired,
		"changesRequiredComment.customText":
			config.changesRequiredComment.customText,
		"changesRequiredComment.showDetailsButton":
			config.changesRequiredComment.showDetailsButton,
		onNote: config.onNote,
		"noteComment.customText": config.noteComment.customText,
		"noteComment.showDetailsButton": config.noteComment.showDetailsButton,
		onClose: config.onClose,
		"closeComment.customText": config.closeComment.customText,
		"closeComment.showDetailsButton": config.closeComment.showDetailsButton,
		"closeComment.gif": encodeGif(config.closeComment.gif),
		failClosedFallback: config.failClosedFallback,
		"redaction.inherit": config.redaction.inherit,
		"redaction.level": config.redaction.level,
		"redaction.surfaces": encodeSurfaces(config.redaction.surfaces),
		"redaction.showHelp": config.redaction.showHelp,
	};
}

export function unflattenConfig(
	flat: Parameters<SaveQueueCommit>[0],
): ResponseConfig {
	return responseConfigSchema.parse({
		onSuccess: flat.onSuccess,
		onBlock: flat.onBlock,
		moderationQueued: flat.moderationQueued,
		passComment: {
			customText: flat["passComment.customText"],
			showDetailsButton: flat["passComment.showDetailsButton"],
		},
		blockComment: {
			mode: flat["blockComment.mode"],
			template: flat["blockComment.template"],
			customText: flat["blockComment.customText"],
			showDetailsButton: flat["blockComment.showDetailsButton"],
		},
		reviewComment: {
			customText: flat["reviewComment.customText"],
			showDetailsButton: flat["reviewComment.showDetailsButton"],
		},
		onChangesRequired: flat.onChangesRequired,
		changesRequiredComment: {
			customText: flat["changesRequiredComment.customText"],
			showDetailsButton: flat["changesRequiredComment.showDetailsButton"],
		},
		onNote: flat.onNote,
		noteComment: {
			customText: flat["noteComment.customText"],
			showDetailsButton: flat["noteComment.showDetailsButton"],
		},
		onClose: flat.onClose,
		closeComment: {
			customText: flat["closeComment.customText"],
			showDetailsButton: flat["closeComment.showDetailsButton"],
			gif: decodeGif(flat["closeComment.gif"]),
		},
		failClosedFallback: flat.failClosedFallback,
		redaction: {
			inherit: flat["redaction.inherit"],
			level: flat["redaction.level"],
			surfaces: decodeSurfaces(
				ENCODED_SURFACES.catch("").parse(flat["redaction.surfaces"]),
			),
			showHelp: flat["redaction.showHelp"],
		},
	});
}

export function postsComment(config: ResponseConfig, outcome: OutcomeMeta) {
	return config[outcome.surface] === "comment";
}

export function blockContentChoice(config: ResponseConfig): ContentChoice {
	if (config.blockComment.customText.trim() !== "") {
		return "message";
	}
	return config.blockComment.mode === "custom"
		? "message"
		: config.blockComment.mode;
}

export function blockDraftKey(config: ResponseConfig): DraftKey {
	return config.blockComment.customText.trim() !== ""
		? "blockComment.customText"
		: "blockComment.template";
}

export function customTextKey(outcome: OutcomeMeta): DraftKey | null {
	switch (outcome.value) {
		case "changes_required":
			return "changesRequiredComment.customText";
		case "needs_review":
			return "reviewComment.customText";
		case "close":
			return "closeComment.customText";
		default:
			return null;
	}
}

export function readDraftKey(config: ResponseConfig, key: DraftKey): string {
	switch (key) {
		case "blockComment.customText":
			return config.blockComment.customText;
		case "blockComment.template":
			return config.blockComment.template;
		case "changesRequiredComment.customText":
			return config.changesRequiredComment.customText;
		case "reviewComment.customText":
			return config.reviewComment.customText;
		case "closeComment.customText":
			return config.closeComment.customText;
	}
}

export function withDrafts(
	config: ResponseConfig,
	drafts: Partial<Record<DraftKey, string>>,
): ResponseConfig {
	if (Object.keys(drafts).length === 0) {
		return config;
	}
	const text = (key: DraftKey) => drafts[key] ?? readDraftKey(config, key);
	return {
		...config,
		blockComment: {
			...config.blockComment,
			customText: text("blockComment.customText"),
			template: text("blockComment.template"),
		},
		changesRequiredComment: {
			...config.changesRequiredComment,
			customText: text("changesRequiredComment.customText"),
		},
		reviewComment: {
			...config.reviewComment,
			customText: text("reviewComment.customText"),
		},
		closeComment: {
			...config.closeComment,
			customText: text("closeComment.customText"),
		},
	};
}

export function sampleInput(outcome: OutcomeMeta): CommentInput {
	const base = {
		verdict: outcome.verdict,
		contributorLogin: "contributor",
		reasons: [] as CommentReason[],
		runUrl: "https://tripwire.sh/runs/sample",
	};
	switch (outcome.value) {
		case "block":
			return { ...base, reasons: SAMPLE_REASONS };
		case "close":
			return { ...base, reasons: CLOSE_REASONS };
		case "changes_required":
			return { ...base, fixes: [{ message: SAMPLE_FIX, reasons: [] }] };
		case "note":
			return { ...base, notes: [SAMPLE_NOTE] };
		default:
			return base;
	}
}

export function previewPlan(
	config: ResponseConfig,
	outcome: OutcomeMeta,
	policy: RedactionPolicy,
): SurfacePlan {
	const previewConfig =
		outcome.value === "block" &&
		config.blockComment.mode === "custom" &&
		config.blockComment.template.trim() === "" &&
		config.blockComment.customText.trim() === ""
			? {
					...config,
					blockComment: {
						...config.blockComment,
						template: TEMPLATE_PLACEHOLDER,
					},
				}
			: config;
	return planSurfaces(sampleInput(outcome), previewConfig, policy, {
		reviewPosted: outcome.value === "block",
	});
}

export interface CheckPreview {
	posted: boolean;
	verdict: Verdict;
	summary: string;
}

export function previewCheck(
	config: ResponseConfig,
	outcome: OutcomeMeta,
	policy: RedactionPolicy,
): CheckPreview {
	const input = sampleInput(outcome);
	return {
		posted: wantsCheck(config, outcome.verdict),
		verdict: outcome.verdict,
		summary: checkSummary(
			outcome.verdict,
			input.reasons,
			false,
			redactionLevelFor(policy, "check"),
			false,
			input,
		),
	};
}

export function commentWanted(config: ResponseConfig, outcome: OutcomeMeta) {
	return wantsComment(config, outcome.verdict, {
		notes: outcome.value === "note",
	});
}
