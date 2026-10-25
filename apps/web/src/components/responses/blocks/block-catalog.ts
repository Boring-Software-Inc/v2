import type {
	BlockOutcome,
	ResponseBlock,
	ResponseBlockType,
	ResponseVariable,
} from "@tripwire/contracts";
import {
	CommentText,
	External,
	FileImage,
	Flag,
	FollowUp,
	type GlazeIcon,
	Heading,
	Help,
	Link,
	ListBullets,
	Mention,
	Paragraph,
	Protected,
	Retry,
	Sparkle,
} from "#/components/glaze/icon";

export type BlockGroupKey = "text" | "run" | "links" | "media";

export interface BlockMeta {
	type: ResponseBlockType;
	label: string;
	icon: GlazeIcon;
	group: BlockGroupKey;
}

export const BLOCK_META: Record<ResponseBlockType, BlockMeta> = {
	headline: {
		type: "headline",
		label: "Headline",
		icon: Mention,
		group: "text",
	},
	"verdict-line": {
		type: "verdict-line",
		label: "Verdict line",
		icon: Flag,
		group: "text",
	},
	instruction: {
		type: "instruction",
		label: "Instruction",
		icon: FollowUp,
		group: "text",
	},
	text: { type: "text", label: "Free text", icon: Paragraph, group: "text" },
	"failed-rules": {
		type: "failed-rules",
		label: "Failed rules",
		icon: ListBullets,
		group: "run",
	},
	notes: { type: "notes", label: "Notes", icon: CommentText, group: "run" },
	"ai-notice": {
		type: "ai-notice",
		label: "AI review skipped",
		icon: Sparkle,
		group: "run",
	},
	"rerun-notice": {
		type: "rerun-notice",
		label: "Rerun note",
		icon: Retry,
		group: "run",
	},
	"run-link": {
		type: "run-link",
		label: "View on Tripwire",
		icon: External,
		group: "links",
	},
	help: {
		type: "help",
		label: "How do I fix this?",
		icon: Help,
		group: "links",
	},
	gif: { type: "gif", label: "GIF", icon: FileImage, group: "media" },
};

export const BLOCK_GROUPS: readonly {
	key: BlockGroupKey;
	title: string;
	icon: GlazeIcon;
}[] = [
	{ key: "text", title: "Text", icon: Heading },
	{ key: "run", title: "Run details", icon: Protected },
	{ key: "links", title: "Links", icon: Link },
	{ key: "media", title: "Media", icon: FileImage },
];

export function offeredBlocks(outcome: BlockOutcome): BlockMeta[] {
	return Object.values(BLOCK_META).filter(
		(meta) =>
			(meta.type !== "gif" || outcome === "close") &&
			(meta.type !== "notes" || outcome !== "note"),
	);
}

export const VARIABLE_LABELS: Record<ResponseVariable, string> = {
	author: "@author",
	"failed-rules": "Failed rules",
	"target-branch": "Target branch",
	title: "Change request title",
	"rule-name": "Rule name",
	"run-link": "Run link",
};

export const INSERTABLE_VARIABLES: readonly ResponseVariable[] = [
	"author",
	"failed-rules",
	"target-branch",
	"title",
];

export function newBlock(type: ResponseBlockType, id: string): ResponseBlock {
	switch (type) {
		case "text":
			return { id, type, parts: [] };
		case "failed-rules":
			return { id, type, style: "full" };
		case "gif":
			return { id, type, gif: null };
		default:
			return { id, type };
	}
}
