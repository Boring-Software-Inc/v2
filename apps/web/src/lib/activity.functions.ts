import { createServerFn } from "@tanstack/react-start";
import type { NormalizedEvent } from "@tripwire/contracts";

/** A run as the /activity feed shows it — verdict + leading reason. */
export interface ActivityRun {
	runId: string;
	verdict: string | null;
	status: string;
	/** The first failing rule's plain-English one-liner (§10), when blocked. */
	reason: string | null;
}

/** One timeline entry (or standalone row): an event + the run it triggered. */
export interface ActivityItem {
	event: NormalizedEvent;
	run: ActivityRun | null;
	/** Client-only: a change-request event still evaluating (optimistic live row). */
	pending?: boolean;
}

/** A change request — the real unit of the feed. One collapsible group. */
export interface ActivityGroup {
	repoFullName: string;
	subjectNumber: number;
	title: string;
	url: string | null;
	actor: { login: string; avatarUrl: string | null };
	currentVerdict: string | null;
	currentRunId: string | null;
	latestActivityAt: string;
	eventCount: number;
	timeline: ActivityItem[];
}

export type ActivityFeedItem =
	| { type: "group"; group: ActivityGroup }
	| { type: "event"; entry: ActivityItem };

export interface ActivityFeedData {
	items: ActivityFeedItem[];
}

export const getActivityFeed = createServerFn({ method: "GET" }).handler(
	async (): Promise<ActivityFeedData> => {
		const { requireSession } = await import("#/lib/server/session");
		await requireSession();
		const { eventServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const feed = await eventServices.listActivityFeed(getDb().db, {
			limit: 50,
		});
		return feed as ActivityFeedData;
	},
);
