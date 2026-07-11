import { z } from "zod";
import { threadKindSchema } from "./insights.ts";
import {
	actorSchema,
	itemTypeSchema,
	reasonSchema,
	severitySchema,
} from "./moderation.ts";

/**
 * Runs domain (spec §4 `runs.ts`: auditable runs + steps). Extracted from the
 * demo's `log.types.ts` — the moderation log IS the runs surface. `Run` was the
 * demo's `LogEntry`, `RunLogStep` its `LogStep`, `RunLogItem` its `LogItem`. The §4
 * `Verdict` union lands with the executor build step.
 */

export const runLogActionSchema = z.enum([
	"removed",
	"hidden",
	"banned",
	"dismissed",
	"required-review",
]);
export type RunLogAction = z.infer<typeof runLogActionSchema>;

export const runLogStatusSchema = z.enum([
	"actioned",
	"dismissed",
	"appealed",
	"reversed",
]);
export type RunLogStatus = z.infer<typeof runLogStatusSchema>;

export const caughtKindSchema = z.enum(["automod", "report", "manual"]);
export type CaughtKind = z.infer<typeof caughtKindSchema>;

export const caughtBySchema = z.object({
	kind: caughtKindSchema,
	/** Rule id, "report", or the action verb — drives the "caught by …" line. */
	detail: z.string(),
	/** Present when a person reported it (we show the reporter). */
	reporter: actorSchema.optional(),
});
export type CaughtBy = z.infer<typeof caughtBySchema>;

/** A single step in a run's lifecycle (flagged → actioned → appealed …). */
export const runLogStepSchema = z.object({
	at: z.iso.datetime(),
	label: z.string(),
	by: z.string(),
});
export type RunLogStep = z.infer<typeof runLogStepSchema>;

/** One piece of offending content in a run. Bundled runs hold several. */
export const runLogItemSchema = z.object({
	id: z.string(),
	type: itemTypeSchema,
	repoFullName: z.string(),
	number: z.number(),
	/** Raw content — kept blurred until revealed. */
	content: z.string(),
	/** Routes the item back to its conversation + the comment to highlight. */
	threadKind: threadKindSchema,
	commentId: z.string(),
});
export type RunLogItem = z.infer<typeof runLogItemSchema>;

/** An auditable run (was demo `LogEntry`). */
export const runLogEntrySchema = z.object({
	id: z.string(),
	/** Safe label shown instead of the raw content, e.g. "Racial slur". */
	label: z.string(),
	reason: reasonSchema,
	severity: severitySchema,
	action: runLogActionSchema,
	status: runLogStatusSchema,
	author: actorSchema,
	/** The moderator who actioned it; null for a pure automod action. */
	moderator: actorSchema.nullable(),
	caughtBy: caughtBySchema,
	at: z.iso.datetime(),
	/** We kept our own copy so it survives upstream deletion. */
	snapshot: z.boolean(),
	items: z.array(runLogItemSchema),
	history: z.array(runLogStepSchema),
});
export type RunLogEntry = z.infer<typeof runLogEntrySchema>;

export const runLogActionKindSchema = z.enum(["what", "reason", "caught"]);
export type RunLogActionKind = z.infer<typeof runLogActionKindSchema>;

/**
 * AUTHORED from spec §4/§6 — the verdict of a run. `needs_review` pauses the
 * run and creates a moderation item (§6: moderation queue = a paused run).
 */
export const verdictSchema = z.enum(["pass", "block", "needs_review"]);
export type Verdict = z.infer<typeof verdictSchema>;
