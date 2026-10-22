import { defineCollection } from "#/lib/collection";
import type { ModerationQueueItem } from "#/lib/moderation-queue.functions";

export function isCommentItem(item: ModerationQueueItem): boolean {
	return item.eventKind === "comment.created";
}

const byCreated = (a: ModerationQueueItem, b: ModerationQueueItem) =>
	a.createdAt.localeCompare(b.createdAt);

export const MODERATION_COLLECTION = defineCollection<ModerationQueueItem>({
	id: "human-review",
	noun: "items",
	search: {
		placeholder: "Search title or author",
		fields: (item) => [
			item.title,
			item.actorLogin,
			item.subjectNumber === null ? null : `#${item.subjectNumber}`,
		],
	},
	filters: [
		{
			key: "kind",
			label: "Kind",
			kind: "select",
			options: [
				{
					value: "change-request",
					label: "Change requests",
					match: (item) => !isCommentItem(item),
				},
				{ value: "comment", label: "Comments", match: isCommentItem },
			],
		},
	],
	sort: [
		{ key: "newest", label: "Newest", compare: (a, b) => byCreated(b, a) },
		{ key: "oldest", label: "Oldest", compare: byCreated },
	],
	defaultSort: "newest",
});
