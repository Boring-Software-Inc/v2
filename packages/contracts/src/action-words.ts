import { z } from "zod";
import { checkStateSchema } from "./check.ts";
import { appealRestorationGuardSchema } from "./contribution-appeals.ts";
import { verdictSchema } from "./runs.ts";
import { storedJsonValueSchema } from "./serialization.ts";
import {
	webhookDeliveryUrlSchema,
	webhookPayloadSchema,
} from "./webhook-payload.ts";
import {
	type JsonValue,
	jsonValueSchema,
	labelParamsSchema,
	lockParamsSchema,
	postCommentParamsSchema,
	requestReviewParamsSchema,
	requestReviewTargetsSchema,
	type WorkflowActionKind,
} from "./workflow.ts";

export type ActionParams = Record<string, JsonValue>;

const actionPayloadRecordSchema = z.record(z.string(), storedJsonValueSchema);
export const storedActionPayloadSchema = z.custom<
	z.infer<typeof actionPayloadRecordSchema>
>(
	(value) =>
		storedJsonValueSchema.safeParse(value).success &&
		actionPayloadRecordSchema.safeParse(value).success,
);
export type StoredActionPayload = z.infer<typeof storedActionPayloadSchema>;

export const deliveryFailureProjectionSchema = z.object({
	deliveryFailure: z.string().optional().catch(undefined),
});
export type DeliveryFailureProjection = z.infer<
	typeof deliveryFailureProjectionSchema
>;

export const deliveryActionPayloadSchema = z.object({
	url: webhookDeliveryUrlSchema,
	delivery: z.custom<z.infer<typeof webhookPayloadSchema>>(
		(value) =>
			storedActionPayloadSchema.safeParse(value).success &&
			webhookPayloadSchema.safeParse(value).success,
	),
	signingSecret: z.string().min(1).optional(),
	deliveryAttempts: z.number().optional(),
});
export type DeliveryActionPayload = z.infer<typeof deliveryActionPayloadSchema>;

/** Discord never consumes a signing secret or sends signature headers. */
export const discordDeliveryPayloadSchema = deliveryActionPayloadSchema
	.omit({ signingSecret: true })
	.transform((payload) => ({ ...payload, signingSecret: undefined }));
export type DiscordDeliveryPayload = z.infer<
	typeof discordDeliveryPayloadSchema
>;

const subjectPayloadSchema = z.object({
	number: z.number().int().positive().optional(),
});

/** Only consumed fields determine whether a persisted intent may execute. */
export const persistedForgeActionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("comment"),
		payload: subjectPayloadSchema.extend({
			body: z.string(),
			verdict: verdictSchema,
			previousVerdict: verdictSchema.nullish(),
			onlyIfPresent: z.boolean().optional(),
		}),
	}),
	z.object({
		kind: z.literal("delete-comment"),
		payload: subjectPayloadSchema,
	}),
	z.object({
		kind: z.literal("dismiss-review"),
		payload: subjectPayloadSchema.extend({
			reviewId: z.string().nullable().optional(),
		}),
	}),
	z.object({ kind: z.literal("set-check"), payload: checkStateSchema }),
	z.object({
		kind: z.literal("label"),
		payload: z.object({ labels: z.array(z.string()) }),
	}),
	z.object({ kind: z.literal("remove-label"), payload: labelParamsSchema }),
	z.object({ kind: z.literal("lock"), payload: lockParamsSchema }),
	z.object({ kind: z.literal("close"), payload: z.object({}) }),
	z.object({
		kind: z.literal("reopen"),
		payload: appealRestorationGuardSchema,
	}),
	z.object({
		kind: z.literal("unlock"),
		payload: appealRestorationGuardSchema,
	}),
	z.object({
		kind: z.literal("post-comment"),
		payload: postCommentParamsSchema.extend({ marker: z.string() }),
	}),
	z.object({
		kind: z.literal("request-review"),
		payload: requestReviewParamsSchema,
	}),
	z.object({
		kind: z.literal("block"),
		payload: z.object({ reason: z.string().optional() }),
	}),
]);
export type PersistedForgeAction = z.infer<typeof persistedForgeActionSchema>;

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
		case "unlock":
			return "Unlocked";
		case "reopen":
			return "Reopened";
		case "close":
			return "Closed";
		default:
			return null;
	}
}
