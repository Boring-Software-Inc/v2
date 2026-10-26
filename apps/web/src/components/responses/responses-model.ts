import type {
	BlockLens,
	BlockOutput,
	BlockViewer,
	CloseGif,
	CommentInput,
	CommentReason,
	RedactionPolicy,
	ResponseBlock,
	ResponseConfig,
	SurfacePlan,
	Verdict,
} from "@tripwire/contracts";
import {
	checkSummary,
	closeGifSchema,
	defaultBlocks,
	planSurfaces,
	redactionLevelFor,
	renderBlockOutputs,
	responseConfigSchema,
	wantsCheck,
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

export interface OutcomeMeta {
	value: OutcomeScope;
	label: string;
	verdict: Verdict;
	surface: CommentSurfaceKey;
	edited: boolean;
}

const BLOCK_OUTCOME: OutcomeMeta = {
	value: "block",
	label: "Block",
	verdict: "block",
	surface: "onBlock",
	edited: false,
};

export const OUTCOMES: readonly OutcomeMeta[] = [
	BLOCK_OUTCOME,
	{
		value: "changes_required",
		label: "Ask author to fix",
		verdict: "changes_required",
		surface: "onChangesRequired",
		edited: true,
	},
	{
		value: "needs_review",
		label: "Human review",
		verdict: "needs_review",
		surface: "moderationQueued",
		edited: false,
	},
	{
		value: "note",
		label: "Note only",
		verdict: "pass",
		surface: "onNote",
		edited: false,
	},
	{
		value: "close",
		label: "Close",
		verdict: "close",
		surface: "onClose",
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

const ENCODED_SURFACES = z.string();

const BLOCK_KEYS = [
	"blocks.block",
	"blocks.changes_required",
	"blocks.needs_review",
	"blocks.note",
	"blocks.close",
] as const;

export type BlockKey = (typeof BLOCK_KEYS)[number];

export function blockKey(outcome: OutcomeMeta): BlockKey {
	return `blocks.${outcome.value}`;
}

export function encodeBlocks(blocks: readonly ResponseBlock[] | undefined) {
	return blocks ? JSON.stringify(blocks) : "";
}

function decodeBlocks(value: unknown): unknown {
	if (typeof value !== "string" || value === "") {
		return undefined;
	}
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

export function outcomeBlocks(
	config: ResponseConfig,
	outcome: OutcomeMeta,
): ResponseBlock[] {
	return (
		config.blocks[outcome.value] ??
		defaultBlocks(config, outcome.verdict, {
			notes: outcome.value === "note",
			surface: "comment",
		})
	);
}

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
		"blocks.block": encodeBlocks(config.blocks.block),
		"blocks.changes_required": encodeBlocks(config.blocks.changes_required),
		"blocks.needs_review": encodeBlocks(config.blocks.needs_review),
		"blocks.note": encodeBlocks(config.blocks.note),
		"blocks.close": encodeBlocks(config.blocks.close),
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
		blocks: Object.fromEntries(
			BLOCK_KEYS.map((key) => [
				key.slice("blocks.".length),
				decodeBlocks(flat[key]),
			]),
		),
	});
}

export function postsComment(config: ResponseConfig, outcome: OutcomeMeta) {
	return config[outcome.surface] === "comment";
}

export function sampleInput(outcome: OutcomeMeta): CommentInput {
	const base = {
		verdict: outcome.verdict,
		contributorLogin: "contributor",
		reasons: [] as CommentReason[],
		runUrl: "https://tripwire.sh/runs/sample",
		title: "Add sponsor wallet",
		targetBranch: "release/2.x",
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
	return planSurfaces(sampleInput(outcome), config, policy, {
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

export interface ResponsePreview {
	blocks: ResponseBlock[];
	lens: BlockLens;
	outputs: BlockOutput[];
	plan: SurfacePlan;
	check: CheckPreview;
	posting: boolean;
	runPageLevel: number;
}

export function responsePreview(
	config: ResponseConfig,
	outcome: OutcomeMeta,
	policy: RedactionPolicy,
	viewer: BlockViewer,
): ResponsePreview {
	const blocks = outcomeBlocks(config, outcome);
	const seen: RedactionPolicy =
		viewer === "member" ? { ...policy, level: 0 } : policy;
	const lens: BlockLens = {
		level: redactionLevelFor(policy, "comment"),
		showHelp: policy.showHelp,
		viewer,
	};
	return {
		blocks,
		lens,
		outputs: renderBlockOutputs(blocks, sampleInput(outcome), lens),
		plan: previewPlan(config, outcome, seen),
		check: previewCheck(config, outcome, seen),
		posting: postsComment(config, outcome),
		runPageLevel: redactionLevelFor(seen, "run-page"),
	};
}
