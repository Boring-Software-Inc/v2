import type {
	BlockCommentMode,
	CommentReason,
	RedactionPolicy,
	ResponseConfig,
	SurfacePlan,
	Verdict,
} from "@tripwire/contracts";
import {
	planSurfaces,
	responseConfigSchema,
	wantsComment,
} from "@tripwire/contracts";
import { z } from "zod";
import {
	decodeSurfaces,
	encodeSurfaces,
} from "#/components/responses/redaction-model";
import type { SaveQueueCommit } from "#/components/save-queue";

export const VERDICTS: { value: Verdict; label: string }[] = [
	{ value: "pass", label: "Passed" },
	{ value: "block", label: "Blocked" },
	{ value: "needs_review", label: "Human review" },
];

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

const TEMPLATE_PLACEHOLDER = "blocked: {{ruleName}}\n\n{{runUrl}}";
const MESSAGE_PLACEHOLDER = "Your message goes here.";

const ENCODED_SURFACES = z.string();

export type ContentChoice = Exclude<BlockCommentMode, "custom"> | "message";

export type DraftKey =
	| "passComment.customText"
	| "blockComment.customText"
	| "blockComment.template"
	| "reviewComment.customText";

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

export function overrideKey(
	verdict: Verdict,
): "passComment" | "blockComment" | "reviewComment" {
	if (verdict === "pass") {
		return "passComment";
	}
	if (verdict === "block") {
		return "blockComment";
	}
	return "reviewComment";
}

export function commentKey(
	verdict: Verdict,
): "onSuccess" | "onBlock" | "moderationQueued" {
	if (verdict === "pass") {
		return "onSuccess";
	}
	if (verdict === "block") {
		return "onBlock";
	}
	return "moderationQueued";
}

export function postsComment(config: ResponseConfig, verdict: Verdict) {
	return wantsComment(config, verdict);
}

export function contentChoice(
	config: ResponseConfig,
	verdict: Verdict,
	messageChosen: boolean,
): ContentChoice {
	const override = config[overrideKey(verdict)];
	if (override.customText.trim() !== "") {
		return "message";
	}
	if (verdict === "block") {
		return config.blockComment.mode === "custom"
			? "message"
			: config.blockComment.mode;
	}
	return messageChosen ? "message" : "full";
}

export function messageDraftKey(
	config: ResponseConfig,
	verdict: Verdict,
): DraftKey {
	if (verdict === "block") {
		return config.blockComment.customText.trim() !== ""
			? "blockComment.customText"
			: "blockComment.template";
	}
	return verdict === "pass"
		? "passComment.customText"
		: "reviewComment.customText";
}

export function readDraftKey(config: ResponseConfig, key: DraftKey): string {
	switch (key) {
		case "passComment.customText":
			return config.passComment.customText;
		case "blockComment.customText":
			return config.blockComment.customText;
		case "blockComment.template":
			return config.blockComment.template;
		case "reviewComment.customText":
			return config.reviewComment.customText;
	}
}

export function withDrafts(
	config: ResponseConfig,
	drafts: Partial<Record<DraftKey, string>>,
): ResponseConfig {
	if (Object.keys(drafts).length === 0) {
		return config;
	}
	return {
		...config,
		passComment: {
			...config.passComment,
			customText:
				drafts["passComment.customText"] ?? config.passComment.customText,
		},
		blockComment: {
			...config.blockComment,
			customText:
				drafts["blockComment.customText"] ?? config.blockComment.customText,
			template: drafts["blockComment.template"] ?? config.blockComment.template,
		},
		reviewComment: {
			...config.reviewComment,
			customText:
				drafts["reviewComment.customText"] ?? config.reviewComment.customText,
		},
	};
}

export function previewPlan(
	config: ResponseConfig,
	verdict: Verdict,
	messageChosen: boolean,
	policy: RedactionPolicy,
): SurfacePlan {
	let previewConfig = config;
	if (
		verdict === "block" &&
		config.blockComment.mode === "custom" &&
		config.blockComment.template.trim() === "" &&
		config.blockComment.customText.trim() === ""
	) {
		previewConfig = {
			...config,
			blockComment: { ...config.blockComment, template: TEMPLATE_PLACEHOLDER },
		};
	} else if (
		verdict !== "block" &&
		messageChosen &&
		config[overrideKey(verdict)].customText.trim() === ""
	) {
		const key = overrideKey(verdict);
		previewConfig = {
			...config,
			[key]: { ...config[key], customText: MESSAGE_PLACEHOLDER },
		};
	}
	return planSurfaces(
		{
			verdict,
			contributorLogin: "contributor",
			reasons: verdict === "block" ? SAMPLE_REASONS : [],
			runUrl: "https://tripwire.sh/runs/sample",
		},
		previewConfig,
		policy,
		{ reviewPosted: verdict === "block" },
	);
}
