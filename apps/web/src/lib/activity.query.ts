import { queryOptions, useQueryClient } from "@tanstack/react-query";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useEffect } from "react";
import {
	type ActivityFeedData,
	type ActivityFeedItem,
	type ActivityGroup,
	type ActivityItem,
	getActivityFeed,
} from "#/lib/activity.functions";

export const activityQueryKeys = {
	all: ["activity"] as const,
	feed: () => [...activityQueryKeys.all, "feed"] as const,
};

export const activityQueryOptions = () =>
	queryOptions({
		queryKey: activityQueryKeys.feed(),
		queryFn: ({ signal }) => getActivityFeed({ signal }),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

/** The (repo, subjectNumber) a gated event belongs to — null when ungrouped. */
function groupOf(
	event: NormalizedEvent,
): { repo: string; subjectNumber: number } | null {
	if (!("repo" in event)) {
		return null;
	}
	if ("changeRequest" in event) {
		return {
			repo: event.repo.fullName,
			subjectNumber: event.changeRequest.number,
		};
	}
	if (event.kind === "comment.created") {
		return {
			repo: event.repo.fullName,
			subjectNumber: event.comment.subjectNumber,
		};
	}
	return null;
}

function eventUrl(event: NormalizedEvent): string | null {
	if ("changeRequest" in event) {
		return event.changeRequest.url;
	}
	if (event.kind === "comment.created") {
		return event.comment.url;
	}
	return null;
}

function groupTitle(event: NormalizedEvent, subjectNumber: number): string {
	return "changeRequest" in event
		? event.changeRequest.title
		: `#${subjectNumber}`;
}

function isPresent(items: ActivityFeedItem[], eventId: string): boolean {
	return items.some((item) =>
		item.type === "group"
			? item.group.timeline.some((t) => t.event.id === eventId)
			: item.entry.event.id === eventId,
	);
}

function findGroup(
	items: ActivityFeedItem[],
	key: { repo: string; subjectNumber: number },
): number {
	return items.findIndex(
		(item) =>
			item.type === "group" &&
			item.group.repoFullName === key.repo &&
			item.group.subjectNumber === key.subjectNumber,
	);
}

/** currentVerdict/run follow the LATEST run in the timeline. */
function withCurrentVerdict(group: ActivityGroup): ActivityGroup {
	const latest = [...group.timeline].reverse().find((t) => t.run);
	return {
		...group,
		currentVerdict: latest?.run?.verdict ?? null,
		currentRunId: latest?.run?.runId ?? null,
	};
}

/** Move an item to the top — a new event bumps its group, never grows the list. */
function bump(items: ActivityFeedItem[], index: number): ActivityFeedItem[] {
	const item = items[index];
	if (!item) {
		return items;
	}
	return [item, ...items.filter((_, i) => i !== index)];
}

function mergeEvent(
	data: ActivityFeedData | undefined,
	event: NormalizedEvent,
): ActivityFeedData {
	const items = data?.items ?? [];
	if (isPresent(items, event.id)) {
		return data ?? { items };
	}
	const entry: ActivityItem = {
		event,
		run: null,
		pending: event.kind.startsWith("change-request."),
	};
	const key = groupOf(event);
	if (!key) {
		return { items: [{ type: "event", entry }, ...items] };
	}
	const idx = findGroup(items, key);
	if (idx >= 0 && items[idx].type === "group") {
		const group = (items[idx] as { group: ActivityGroup }).group;
		const updated: ActivityGroup = {
			...group,
			timeline: [...group.timeline, entry],
			eventCount: group.eventCount + 1,
			latestActivityAt: event.receivedAt,
		};
		return {
			items: bump(
				[
					{ type: "group", group: updated },
					...items.filter((_, i) => i !== idx),
				],
				0,
			),
		};
	}
	const group: ActivityGroup = {
		repoFullName: key.repo,
		subjectNumber: key.subjectNumber,
		title: groupTitle(event, key.subjectNumber),
		url: eventUrl(event),
		actor: {
			login: event.actor.login,
			avatarUrl: event.actor.avatarUrl ?? null,
		},
		currentVerdict: null,
		currentRunId: null,
		latestActivityAt: event.receivedAt,
		eventCount: 1,
		timeline: [entry],
	};
	return { items: [{ type: "group", group }, ...items] };
}

function mergeRun(
	data: ActivityFeedData | undefined,
	resolved: ActivityItem,
): ActivityFeedData {
	const items = data?.items ?? [];
	const { event } = resolved;
	const settled: ActivityItem = { ...resolved, pending: false };
	const key = groupOf(event);
	if (!key) {
		return {
			items: items.map((item) =>
				item.type === "event" && item.entry.event.id === event.id
					? { type: "event", entry: settled }
					: item,
			),
		};
	}
	const idx = findGroup(items, key);
	if (idx < 0 || items[idx].type !== "group") {
		// The group isn't cached yet — seed it, then resolve into it.
		return mergeRun(mergeEvent({ items }, event), resolved);
	}
	const group = (items[idx] as { group: ActivityGroup }).group;
	const has = group.timeline.some((t) => t.event.id === event.id);
	const timeline = has
		? group.timeline.map((t) => (t.event.id === event.id ? settled : t))
		: [...group.timeline, settled];
	const updated = withCurrentVerdict({
		...group,
		timeline,
		latestActivityAt: event.receivedAt,
	});
	return {
		items: bump(
			[{ type: "group", group: updated }, ...items.filter((_, i) => i !== idx)],
			0,
		),
	};
}

/**
 * §9 live merge over the GROUPED feed. `event` upserts a timeline entry into
 * its change-request group (bumping the group to the top, never growing the
 * list); `run` resolves that entry in place and re-derives the group's current
 * verdict. Ungrouped events (installation) are standalone rows. No polling.
 */
export function useActivityStream(enabled = true): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const source = new EventSource("/api/events/stream");
		source.addEventListener("event", (message) => {
			const event = JSON.parse(message.data) as NormalizedEvent;
			queryClient.setQueryData<ActivityFeedData>(
				activityQueryKeys.feed(),
				(c) => mergeEvent(c, event),
			);
		});
		source.addEventListener("run", (message) => {
			const resolved = JSON.parse(message.data) as ActivityItem;
			queryClient.setQueryData<ActivityFeedData>(
				activityQueryKeys.feed(),
				(c) => mergeRun(c, resolved),
			);
		});
		return () => source.close();
	}, [enabled, queryClient]);
}
