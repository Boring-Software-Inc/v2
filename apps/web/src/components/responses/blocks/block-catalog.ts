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
} from "#/design-system/icon";

export type BlockGroupKey = "text" | "run" | "links" | "media";

export interface BlockMeta {
	type: ResponseBlockType;
	label: string;
	description: string;
	icon: GlazeIcon;
	group: BlockGroupKey;
}

export const BLOCK_META = {
	headline: {
		type: "headline",
		label: "Headline",
		description: "States Tripwire's outcome for the contributor.",
		icon: Mention,
		group: "text",
	},
	"verdict-line": {
		type: "verdict-line",
		label: "Verdict line",
		description: "Summarizes the check result in one sentence.",
		icon: Flag,
		group: "text",
	},
	instruction: {
		type: "instruction",
		label: "Instruction",
		description: "Explains what the contributor should do next.",
		icon: FollowUp,
		group: "text",
	},
	text: {
		type: "text",
		label: "Free text",
		description: "Adds your own message with optional run details.",
		icon: Paragraph,
		group: "text",
	},
	"failed-rules": {
		type: "failed-rules",
		label: "Failed rules",
		description: "Lists the rules that did not pass and their fix hints.",
		icon: ListBullets,
		group: "run",
	},
	notes: {
		type: "notes",
		label: "Notes",
		description: "Includes notes Tripwire recorded while checking the run.",
		icon: CommentText,
		group: "run",
	},
	"ai-notice": {
		type: "ai-notice",
		label: "AI review not run",
		description: "Says when AI review could not run because credits ran out.",
		icon: Sparkle,
		group: "run",
	},
	"rerun-notice": {
		type: "rerun-notice",
		label: "Rerun note",
		description: "Marks a response created after the rules ran again.",
		icon: Retry,
		group: "run",
	},
	"run-link": {
		type: "run-link",
		label: "View on Tripwire",
		description: "Links contributors to the full run on Tripwire.",
		icon: External,
		group: "links",
	},
	help: {
		type: "help",
		label: "How do I fix this?",
		description: "Adds expandable guidance based on the failed rules.",
		icon: Help,
		group: "links",
	},
	gif: {
		type: "gif",
		label: "GIF",
		description: "Adds a GIF to the close response.",
		icon: FileImage,
		group: "media",
	},
} satisfies Record<ResponseBlockType, BlockMeta>;

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

export const VARIABLE_LABELS = {
	author: "@author",
	"failed-rules": "Failed rules",
	"target-branch": "Target branch",
	title: "Change request title",
	"rule-name": "Rule name",
	"run-link": "Run link",
} satisfies Record<ResponseVariable, string>;

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
