import { z } from "zod";
import { normalizedEventSchema } from "./events.ts";

/**
 * The /activity feed wire shapes (§4/§9). These cross the server→client boundary
 * (the `getActivityFeed` server fn and the SSE `run` event), so they live HERE in
 * contracts — ONE home, validated — not duplicated in db services and web.
 *
 * The feed's unit is the CHANGE REQUEST: one collapsible group per PR carrying
 * its timeline (every event + the run it triggered). Events with no change
 * request (installation) are standalone entries.
 */

/** A run as the feed shows it — verdict + the leading reason when blocked. */
export const activityRunSummarySchema = z.object({
	runId: z.string(),
	verdict: z.string().nullable(),
	status: z.string(),
	/** The first failing rule's one-liner (§10), or its name as a fallback. */
	reason: z.string().nullable(),
});
export type ActivityRunSummary = z.infer<typeof activityRunSummarySchema>;

/** One timeline entry (or standalone row): an event + the run it triggered. */
export const activityTimelineEntrySchema = z.object({
	event: normalizedEventSchema,
	run: activityRunSummarySchema.nullable(),
	/**
	 * Client-only optimistic flag — a change request still evaluating in the live
	 * cache. The server NEVER emits it (hence optional); it exists so the web can
	 * augment the wire shape in place without a second type.
	 */
	pending: z.boolean().optional(),
});
export type ActivityTimelineEntry = z.infer<typeof activityTimelineEntrySchema>;

/** A change request — the real unit of the feed. One collapsible group. */
export const activityGroupSchema = z.object({
	repoFullName: z.string(),
	subjectNumber: z.number().int(),
	title: z.string(),
	url: z.string().nullable(),
	actor: z.object({ login: z.string(), avatarUrl: z.string().nullable() }),
	currentVerdict: z.string().nullable(),
	currentRunId: z.string().nullable(),
	/** ISO-8601 — the latest activity time (drives ordering + the row's clock). */
	latestActivityAt: z.iso.datetime(),
	eventCount: z.number().int(),
	timeline: z.array(activityTimelineEntrySchema),
});
export type ActivityGroup = z.infer<typeof activityGroupSchema>;

export const activityFeedItemSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("group"), group: activityGroupSchema }),
	z.object({ type: z.literal("event"), entry: activityTimelineEntrySchema }),
]);
export type ActivityFeedItem = z.infer<typeof activityFeedItemSchema>;

export const activityFeedSchema = z.object({
	items: z.array(activityFeedItemSchema),
});
export type ActivityFeed = z.infer<typeof activityFeedSchema>;
