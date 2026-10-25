import { z } from "zod";
import { repoRefSchema } from "./repo.ts";

/**
 * Moderation domain (spec §6: the moderation queue is a paused run; §4 db
 * `moderation.ts`). Extracted from the demo's `moderation.types.ts` —
 * `ModerationItem` was the demo's `FlaggedItem`. The base primitives here
 * (actor, item type, stat) are reused by the rules and runs domains.
 */

/**
 * Forge-derived values — GitHub controls this set, not tripwire. Stays closed
 * while mocks drive the UI; needs a passthrough/catch variant when real ingest
 * lands (build step 3/4). Do not widen before then.
 */
export const itemTypeSchema = z.enum(["issue", "pull", "comment"]);
export type ItemType = z.infer<typeof itemTypeSchema>;

export const reasonSchema = z.enum([
	"spam",
	"harassment",
	"off-topic",
	"automod",
	"nsfw",
]);
export type Reason = z.infer<typeof reasonSchema>;

export const modStatusSchema = z.enum(["pending", "resolved"]);
export type ModStatus = z.infer<typeof modStatusSchema>;

export const actorSchema = z.object({
	login: z.string(),
	avatarUrl: z.string(),
});
export type Actor = z.infer<typeof actorSchema>;

/**
 * An item in the moderation queue (was demo `FlaggedItem`).
 *
 * Provenance invariant (enforced below): automod-sourced items have
 * `reporter: null` and carry `automodRule`; human reports have a `reporter`
 * and no `automodRule`. The two fields must agree.
 */
export const moderationItemSchema = z
	.object({
		id: z.string(),
		type: itemTypeSchema,
		repository: repoRefSchema,
		number: z.number(),
		title: z.string(),
		bodyPreview: z.string(),
		author: actorSchema,
		reason: reasonSchema,
		/** `null` when the report came from automod rather than a person. */
		reporter: actorSchema.nullable(),
		automodRule: z.string().optional(),
		reportedAt: z.iso.datetime(),
		status: modStatusSchema,
		comments: z.number(),
		reactions: z.number(),
	})
	.superRefine((item, ctx) => {
		if (item.reporter === null && item.automodRule === undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["automodRule"],
				message:
					"automod-sourced items (reporter: null) must name the automodRule that fired",
			});
		}
		if (item.reporter !== null && item.automodRule !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["automodRule"],
				message:
					"human-reported items (reporter set) must not carry an automodRule",
			});
		}
	});
export type ModerationItem = z.infer<typeof moderationItemSchema>;

export const modStatSchema = z.object({
	value: z.number(),
	/** Signed change vs. the previous period; drives the ▲/▼ indicator. */
	delta: z.number(),
	/** Hourly trend over the last 24h — drives the card's dither chart. */
	series: z.array(z.number()),
});
export type ModStat = z.infer<typeof modStatSchema>;

/**
 * The maintainer's real questions on Home (§13.10). Each stat's `value` and
 * `series` describe the SAME window: `blocked`/`passed` are 24h flow (count +
 * hourly series); `sentToReview` is the CURRENT queue depth (the actionable
 * number) with a 24h queue-depth series whose last point IS the value.
 */
export const modStatsSchema = z.object({
	sentToReview: modStatSchema,
	blocked: modStatSchema,
	passed: modStatSchema,
});
export type ModStats = z.infer<typeof modStatsSchema>;

export const moderationActionSchema = z.enum(["approve", "remove", "ban"]);
export type ModerationAction = z.infer<typeof moderationActionSchema>;
