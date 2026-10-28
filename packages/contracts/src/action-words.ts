import { z } from "zod";
import {
	type JsonValue,
	jsonValueSchema,
	labelParamsSchema,
	requestReviewTargetsSchema,
	type WorkflowActionKind,
} from "./workflow.ts";

export type ActionParams = Record<string, JsonValue>;

export const actionParamsSchema = z
	.record(z.string(), jsonValueSchema)
	.catch({});

export function listWords(words: readonly string[]): string {
	if (words.length <= 1) {
		return words[0] ?? "";
	}
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function labelsOf(params: ActionParams): string[] {
	const parsed = labelParamsSchema.safeParse(params);
	return parsed.success ? parsed.data.labels : [];
}

function labelPhrase(labels: readonly string[]): string {
	return `${labels.length === 1 ? "the label" : "the labels"} ${listWords(labels)}`;
}

function reviewersOf(params: ActionParams): string[] {
	const parsed = requestReviewTargetsSchema.safeParse(params);
	if (!parsed.success) {
		return [];
	}
	return [
		...parsed.data.reviewers.map((reviewer) => reviewer.login),
		...parsed.data.teamReviewers,
	];
}

export function actionEffect(
	action: WorkflowActionKind,
	params: ActionParams,
): string {
	switch (action) {
		case "block":
			return "blocks it";
		case "label": {
			const labels = labelsOf(params);
			return labels.length > 0 ? `adds ${labelPhrase(labels)}` : "adds labels";
		}
		case "remove-label": {
			const labels = labelsOf(params);
			return labels.length > 0
				? `removes ${labelPhrase(labels)}`
				: "removes labels";
		}
		case "request-review": {
			const who = reviewersOf(params);
			return who.length > 0
				? `requests GitHub review from ${listWords(who)}`
				: "requests GitHub review";
		}
		case "send-to-moderation":
			return "sends it to human review";
		case "webhook":
			return "posts the verdict to a webhook";
		case "discord":
			return "posts the verdict to Discord";
		case "lock":
			return "locks the conversation";
		case "close":
			return "closes it";
		case "post-comment":
			return "posts your comment";
		case "request-fix":
			return "asks the author to fix it";
		case "note":
			return "adds a note";
		default:
			return action;
	}
}

export function actionDone(kind: string, params: ActionParams): string | null {
	switch (kind) {
		case "label": {
			const labels = labelsOf(params);
			return labels.length > 0 ? `Labeled ${labels.join(", ")}` : "Labeled";
		}
		case "remove-label": {
			const labels = labelsOf(params);
			return labels.length > 0
				? `Removed label ${labels.join(", ")}`
				: "Removed labels";
		}
		case "post-comment":
			return "Workflow comment";
		case "comment":
			return "Verdict comment";
		case "request-review": {
			const who = reviewersOf(params);
			return who.length > 0
				? `Requested review from ${who.join(", ")}`
				: "Requested GitHub review";
		}
		case "lock":
			return "Locked";
		case "close":
			return "Closed";
		default:
			return null;
	}
}
