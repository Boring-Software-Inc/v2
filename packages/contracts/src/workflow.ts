import { z } from "zod";
import {
	type EventKind,
	eventKindSchema,
	threadSubjectSchema,
} from "./events.ts";
import {
	cronShortestGap,
	isValidTimeZone,
	nextCronRun,
	parseCron,
} from "./workflow-cron.ts";

/** How often the worker looks for due schedules, in minutes. */
export const SCHEDULE_TICK_MINUTES = 5;

/** JSON — rule configs and action params are JSON on the wire by definition. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * Workflow domain (spec §4 `workflow.ts`) — AUTHORED from §6. A workflow is a
 * JSON DAG: trigger nodes → rule nodes → gate nodes (all-of / any-of / not) →
 * action nodes. The executor eats this JSON from build step 6; the React Flow
 * editor that emits it comes last.
 *
 * Semantics (enforced by core/workflow):
 * - a rule/action node runs when ≥1 incoming edge conducts; a trigger conducts
 *   when its kinds include the event kind.
 * - a GATE node runs once ≥1 of its source nodes has settled and folds every
 *   input, failures included (Kleene three-valued, see foldGate).
 * - `skipped` is unknown: a rule that can't evaluate conducts on no port. A
 *   node that no edge conducts into, with an unknown among its inputs, settles
 *   as skipped too, so unknown never fires an action.
 * - a gate input whose source was certainly never reached does not pass. A
 *   gate whose inputs were all certainly never reached is never reached.
 * - edges conduct on the source's outcome: `when: "pass"` (default) | "fail";
 *   `approve`/`deny` edges leave a send-to-moderation node and conduct only
 *   when the moderation decision resumes the run (§6: paused run).
 */

/**
 * Editor layout (§editor rebuild): where the node sits on the canvas.
 * OPTIONAL and semantically inert — the executor ignores it, historical
 * snapshots without it still parse. Persisting it in the definition keeps
 * one artifact (no separate layout blob that can drift).
 */
export const nodePositionSchema = z.object({ x: z.number(), y: z.number() });
export type NodePosition = z.infer<typeof nodePositionSchema>;

export const gateModeSchema = z.enum(["all-of", "any-of", "not", "unless"]);
export type GateMode = z.infer<typeof gateModeSchema>;

export const workflowActionKindSchema = z.enum([
	"block",
	"comment",
	"label",
	"request-review",
	"send-to-moderation",
	"webhook",
	"discord",
	"lock",
	"close",
	"remove-label",
	"post-comment",
	"request-fix",
	"note",
]);
export type WorkflowActionKind = z.infer<typeof workflowActionKindSchema>;

export const REMOVED_ACTION_KINDS = [
	"comment",
] as const satisfies readonly WorkflowActionKind[];
export type RemovedActionKind = (typeof REMOVED_ACTION_KINDS)[number];

export function isRemovedAction(kind: string): kind is RemovedActionKind {
	return (REMOVED_ACTION_KINDS as readonly string[]).includes(kind);
}

/**
 * Config for the outbound-delivery actions. The URL declares `.meta({ secret:
 * true })` so the node face and the panel mask it (display only — at-rest is a
 * separate, tracked concern, see [[webhook-payload]]). Params on the action
 * node validate against these on write.
 */
export const webhookParamsSchema = z.object({
	url: z.url().meta({ secret: true }).describe("webhook url"),
	/** Optional HMAC-SHA256 signing secret — receivers verify the POST came
	 * from tripwire (X-Webhook-Signature). Masked, set-only, like the url. */
	signingSecret: z
		.string()
		.min(1)
		.optional()
		.meta({ secret: true })
		.describe("signing secret"),
});
export const discordParamsSchema = z.object({
	url: z.url().meta({ secret: true }).describe("discord webhook url"),
});

export const MAX_REVIEW_TARGETS = 15;

export const githubLoginSchema = z
	.string()
	.regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, {
		error: (issue) => `${String(issue.input)} is not a GitHub username`,
	});

export const githubTeamSlugSchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/, {
		error: (issue) => `${String(issue.input)} is not a team slug`,
	});

export const reviewerRefSchema = z.object({
	id: z.number().int().positive().optional(),
	login: githubLoginSchema,
});
export type ReviewerRef = z.infer<typeof reviewerRefSchema>;

export const repoReviewerSchema = z.object({
	id: z.number().int().positive(),
	login: githubLoginSchema,
	avatarUrl: z.string(),
	permission: z.string().min(1),
});
export type RepoReviewer = z.infer<typeof repoReviewerSchema>;

export const repoLabelSchema = z.object({
	name: z.string().min(1),
	color: z.string().regex(/^[0-9a-fA-F]{6}$/),
	description: z.string().nullable(),
});
export type RepoLabel = z.infer<typeof repoLabelSchema>;

export const storedReviewerSchema = z.preprocess(
	(value) => (z.string().safeParse(value).success ? { login: value } : value),
	reviewerRefSchema,
);

export function reviewerJson(reviewers: readonly ReviewerRef[]): JsonValue[] {
	return reviewers.map(
		(reviewer): JsonValue =>
			reviewer.id === undefined
				? { login: reviewer.login }
				: { id: reviewer.id, login: reviewer.login },
	);
}

export function sameReviewer(a: ReviewerRef, b: ReviewerRef): boolean {
	return a.id !== undefined && b.id !== undefined
		? a.id === b.id
		: a.login.toLowerCase() === b.login.toLowerCase();
}

export const requestReviewTargetsSchema = z.object({
	reviewers: z
		.array(storedReviewerSchema)
		.max(MAX_REVIEW_TARGETS, `ask at most ${MAX_REVIEW_TARGETS} people`)
		.default([]),
	teamReviewers: z
		.array(githubTeamSlugSchema)
		.max(MAX_REVIEW_TARGETS, `ask at most ${MAX_REVIEW_TARGETS} teams`)
		.default([]),
});
export type RequestReviewTargets = z.infer<typeof requestReviewTargetsSchema>;

export const requestReviewParamsSchema = requestReviewTargetsSchema.superRefine(
	(targets, ctx) => {
		const total = targets.reviewers.length + targets.teamReviewers.length;
		if (total === 0) {
			ctx.addIssue({
				code: "custom",
				message: "add at least one person or team to ask",
			});
		}
		if (total > MAX_REVIEW_TARGETS) {
			ctx.addIssue({
				code: "custom",
				message: `ask at most ${MAX_REVIEW_TARGETS} people and teams`,
			});
		}
	},
);

export const labelParamsSchema = z.object({
	labels: z.array(z.string().trim().min(1)).min(1, "choose at least one label"),
});
export type LabelParams = z.infer<typeof labelParamsSchema>;

export const MAX_COMMENT_MESSAGE = 5000;

export const postCommentParamsSchema = z.object({
	message: z
		.string()
		.trim()
		.min(1, "write a message")
		.max(
			MAX_COMMENT_MESSAGE,
			`keep it under ${MAX_COMMENT_MESSAGE} characters`,
		),
});
export type PostCommentParams = z.infer<typeof postCommentParamsSchema>;

export const MAX_OUTCOME_MESSAGE = 500;

const outcomeMessageSchema = z
	.string()
	.trim()
	.max(MAX_OUTCOME_MESSAGE, `keep it under ${MAX_OUTCOME_MESSAGE} characters`);

export const requestFixParamsSchema = z.object({
	message: outcomeMessageSchema.min(1, "write the fix instruction"),
});
export type RequestFixParams = z.infer<typeof requestFixParamsSchema>;

export const storedRequestFixParamsSchema = z.object({
	message: outcomeMessageSchema.optional(),
});

export const noteParamsSchema = z.object({
	message: outcomeMessageSchema.optional(),
});
export type NoteParams = z.infer<typeof noteParamsSchema>;

export const lockReasonSchema = z.enum([
	"resolved",
	"off-topic",
	"too heated",
	"spam",
]);
export type LockReason = z.infer<typeof lockReasonSchema>;

export const lockParamsSchema = z.object({
	reason: lockReasonSchema.optional(),
});
export type LockParams = z.infer<typeof lockParamsSchema>;

export const DURATION_UNIT_MS = {
	hours: 60 * 60_000,
	days: 24 * 60 * 60_000,
	weeks: 7 * 24 * 60 * 60_000,
	months: 30 * 24 * 60 * 60_000,
} as const;
export type DurationUnit = keyof typeof DURATION_UNIT_MS;

export function durationMs(duration: {
	n: number;
	unit: DurationUnit;
}): number {
	return duration.n * DURATION_UNIT_MS[duration.unit];
}

export const MAX_SCHEDULE_EVERY_MS = 52 * DURATION_UNIT_MS.weeks;
export const MAX_INACTIVE_FOR_MS = 3650 * DURATION_UNIT_MS.days;

export const everyUnitSchema = z.enum(["hours", "days", "weeks"]);
export type EveryUnit = z.infer<typeof everyUnitSchema>;
export const inactiveUnitSchema = z.enum(["hours", "days", "weeks", "months"]);
export type InactiveUnit = z.infer<typeof inactiveUnitSchema>;

export const scheduleEverySchema = z
	.object({ n: z.number().int().min(1), unit: everyUnitSchema })
	.refine((every) => durationMs(every) <= MAX_SCHEDULE_EVERY_MS, {
		message: "runs at least once a year",
	});
export type ScheduleInterval = z.infer<typeof scheduleEverySchema>;

/**
 * The timezone a clock-based schedule (preset or cron) runs in when it names
 * none. Every read-back of a schedule states its zone, defaulted or not.
 */
export const DEFAULT_SCHEDULE_TIMEZONE = "UTC";

export const scheduleTimezoneSchema = z
	.string()
	.min(1)
	.refine(isValidTimeZone, {
		error: (issue) =>
			`${String(issue.input)} is not an IANA timezone, like Europe/Berlin`,
	});

export const timeOfDaySchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM, like 07:30");
export type TimeOfDay = z.infer<typeof timeOfDaySchema>;

export const weekdaySchema = z.enum([
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
]);
export type Weekday = z.infer<typeof weekdaySchema>;

export const schedulePresetSchema = z.discriminatedUnion("preset", [
	z.object({
		preset: z.literal("hourly"),
		minute: z.number().int().min(0).max(59),
	}),
	z.object({ preset: z.literal("daily"), at: timeOfDaySchema }),
	z.object({ preset: z.literal("weekdays"), at: timeOfDaySchema }),
	z.object({
		preset: z.literal("weekly"),
		on: weekdaySchema,
		at: timeOfDaySchema,
	}),
	z.object({
		preset: z.literal("monthly"),
		day: z.number().int().min(1).max(28),
		at: timeOfDaySchema,
	}),
]);
export type SchedulePreset = z.infer<typeof schedulePresetSchema>;
export type SchedulePresetKind = SchedulePreset["preset"];

export const scheduleCronSchema = z.object({
	cron: z
		.string()
		.trim()
		.superRefine((expression, ctx) => {
			const parsed = parseCron(expression);
			if (!parsed.ok) {
				ctx.addIssue({ code: "custom", message: parsed.error });
				return;
			}
			if (
				nextCronRun(parsed.spec, "UTC", new Date(Date.UTC(2026, 0, 1))) === null
			) {
				ctx.addIssue({
					code: "custom",
					message: "this cron never runs. Pick a day the month has",
				});
			}
			if (cronShortestGap(parsed.spec) < SCHEDULE_TICK_MINUTES) {
				ctx.addIssue({
					code: "custom",
					message: `runs must be at least ${SCHEDULE_TICK_MINUTES} minutes apart`,
				});
			}
		}),
});
export type ScheduleCron = z.infer<typeof scheduleCronSchema>;

/**
 * When a schedule runs: a fixed interval (the original shape, still stored
 * as `{ n, unit }`), a preset, or a cron expression.
 */
export const scheduleCadenceSchema = z.union([
	scheduleEverySchema,
	schedulePresetSchema,
	scheduleCronSchema,
]);
export type ScheduleCadence = z.infer<typeof scheduleCadenceSchema>;

export const inactiveForSchema = z
	.object({ n: z.number().int().min(1), unit: inactiveUnitSchema })
	.refine((inactive) => durationMs(inactive) <= MAX_INACTIVE_FOR_MS, {
		message: "10 years at most",
	});
export type InactiveFor = z.infer<typeof inactiveForSchema>;

export const scheduleStateSchema = z.enum(["open", "closed", "any"]);
export type ScheduleState = z.infer<typeof scheduleStateSchema>;

const labelListSchema = z.array(z.string().min(1));

export const scheduleMatchConfigSchema = z.object({
	subjects: z.array(threadSubjectSchema).min(1),
	state: scheduleStateSchema,
	inactiveFor: inactiveForSchema,
	labels: labelListSchema.optional(),
	excludeLabels: labelListSchema.optional(),
	skipLocked: z.boolean().default(true),
});
export type ScheduleMatchConfig = z.infer<typeof scheduleMatchConfigSchema>;

export const triggerScheduleSchema = z.object({
	every: scheduleCadenceSchema,
	timezone: scheduleTimezoneSchema.optional(),
	match: scheduleMatchConfigSchema,
});
export type TriggerSchedule = z.infer<typeof triggerScheduleSchema>;

export const scheduleDraftSchema = z.object({
	every: scheduleCadenceSchema.optional(),
	timezone: scheduleTimezoneSchema.optional(),
	match: z
		.object({
			subjects: z.array(threadSubjectSchema).optional(),
			state: scheduleStateSchema.optional(),
			inactiveFor: inactiveForSchema.optional(),
			labels: labelListSchema.optional(),
			excludeLabels: labelListSchema.optional(),
			skipLocked: z.boolean().optional(),
		})
		.default({}),
});
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>;

export const NEW_SCHEDULE_DRAFT: ScheduleDraft = {
	match: { skipLocked: true },
};

export const SCHEDULE_STEPS = [
	"every",
	"subjects",
	"state",
	"inactiveFor",
] as const;
export type ScheduleStep = (typeof SCHEDULE_STEPS)[number];

export function missingScheduleSteps(
	draft: ScheduleDraft | undefined,
): ScheduleStep[] {
	return SCHEDULE_STEPS.filter((step) => {
		if (!draft) {
			return true;
		}
		if (step === "every") {
			return draft.every === undefined;
		}
		const value = draft.match[step];
		return Array.isArray(value) ? value.length === 0 : value === undefined;
	});
}

export function completeSchedule(
	draft: ScheduleDraft | undefined,
): TriggerSchedule | null {
	const parsed = triggerScheduleSchema.safeParse(draft);
	return parsed.success ? parsed.data : null;
}

export const workflowNodeIdSchema = z.string();

export const triggerNodeSchema = z.object({
	id: workflowNodeIdSchema,
	type: z.literal("trigger"),
	kinds: z.array(eventKindSchema).min(1),
	schedule: scheduleDraftSchema.optional(),
	position: nodePositionSchema.optional(),
});

export type TriggerNode = z.infer<typeof triggerNodeSchema>;

export function isScheduleTrigger(node: {
	type: string;
	kinds?: readonly string[];
}): boolean {
	return (
		node.type === "trigger" && (node.kinds ?? []).includes("schedule.matched")
	);
}

export const ruleNodeSchema = z.object({
	id: workflowNodeIdSchema,
	type: z.literal("rule"),
	/** `id@version`, e.g. "account-age@1" — the versioning law (§6). */
	ref: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/),
	config: jsonValueSchema,
	position: nodePositionSchema.optional(),
});

export const gateNodeSchema = z.object({
	id: workflowNodeIdSchema,
	type: z.literal("gate"),
	mode: gateModeSchema,
	position: nodePositionSchema.optional(),
});

export const actionNodeSchema = z.object({
	id: workflowNodeIdSchema,
	type: z.literal("action"),
	action: workflowActionKindSchema,
	params: z.record(z.string(), jsonValueSchema).optional(),
	position: nodePositionSchema.optional(),
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
	triggerNodeSchema,
	ruleNodeSchema,
	gateNodeSchema,
	actionNodeSchema,
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const edgeWhenSchema = z.enum(["pass", "fail", "approve", "deny"]);
export type EdgeWhen = z.infer<typeof edgeWhenSchema>;

export const gateInputSchema = z.enum(["requirement", "exception"]);
export type GateInput = z.infer<typeof gateInputSchema>;

export const workflowEdgeSchema = z.object({
	id: z.string(),
	from: workflowNodeIdSchema,
	to: workflowNodeIdSchema,
	/** Default: conducts on "pass". */
	when: edgeWhenSchema.optional(),
	input: gateInputSchema.optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowDefinitionSchema = z.object({
	id: z.string(),
	name: z.string(),
	version: z.number().int().min(1),
	nodes: z.array(workflowNodeSchema).min(1),
	edges: z.array(workflowEdgeSchema),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/**
 * The hand-seeded default workflow (§13.6): its id, name and trigger name the
 * derived "Rules" workflow, and it stays a test fixture. Its rule nodes are
 * NOT a baseline: no rule runs until a maintainer turns it on (derive.ts).
 */
export const DEFAULT_WORKFLOW: WorkflowDefinition = {
	id: "default@1",
	name: "default gate",
	version: 1,
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
		{
			id: "account-age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		},
		{ id: "crypto", type: "rule", ref: "crypto-address@1", config: {} },
		{
			id: "honeypot",
			type: "rule",
			ref: "honeypot@1",
			config: { paths: [".github/workflows/**"] },
		},
		{
			id: "max-files",
			type: "rule",
			ref: "max-files-changed@1",
			config: { max: 200 },
		},
		{
			id: "english",
			type: "rule",
			ref: "english-only@1",
			config: { maxNonLatinRatio: 0.5 },
		},
		{ id: "gate", type: "gate", mode: "all-of" },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "trigger", to: "account-age" },
		{ id: "e2", from: "trigger", to: "crypto" },
		{ id: "e3", from: "trigger", to: "honeypot" },
		{ id: "e4", from: "trigger", to: "max-files" },
		{ id: "e5", from: "trigger", to: "english" },
		{ id: "e6", from: "account-age", to: "gate" },
		{ id: "e7", from: "crypto", to: "gate" },
		{ id: "e8", from: "honeypot", to: "gate" },
		{ id: "e9", from: "max-files", to: "gate" },
		{ id: "e10", from: "english", to: "gate" },
		{ id: "e11", from: "gate", to: "block", when: "fail" },
	],
};

export const RULES_WORKFLOW_NAME = "Rules";

export function workflowDisplayName(definition: {
	id: string;
	name: string;
}): string {
	return definition.id === DEFAULT_WORKFLOW.id
		? RULES_WORKFLOW_NAME
		: definition.name;
}

/**
 * Toolbox catalogs (§editor rebuild) — machine-readable metadata for every
 * node kind the editor can place, so the palette renders from data and a new
 * kind appears without touching components. Descriptions are UX copy
 * (constitution voice): one plain-language line, no jargon. Rule metadata
 * lives in RULE_CATALOG (rules.ts), which carries `description` for the same
 * purpose.
 */
export interface TriggerCatalogEntry {
	kind: EventKind;
	name: string;
	description: string;
	/** Installation events are plumbing — no workflow triggers on them. */
	toolbox: boolean;
}

export const TRIGGER_CATALOG: TriggerCatalogEntry[] = [
	{
		kind: "change-request.opened",
		name: "Change request opened",
		description: "Runs when someone opens a change request.",
		toolbox: true,
	},
	{
		kind: "change-request.updated",
		name: "Change request updated",
		description: "Runs when a change request gets new commits or edits.",
		toolbox: true,
	},
	{
		kind: "change-request.closed",
		name: "Change request closed",
		description: "Runs when a change request is closed.",
		toolbox: true,
	},
	{
		kind: "comment.created",
		name: "Comment created",
		description: "Runs when someone comments on a change request or issue.",
		toolbox: true,
	},
	{
		kind: "push",
		name: "Push",
		description: "Runs when commits are pushed to the repo.",
		toolbox: true,
	},
	{
		kind: "schedule.matched",
		name: "On a schedule",
		description: "Runs on a timer for issues and change requests that match.",
		toolbox: true,
	},
	{
		kind: "installation.created",
		name: "Installation created",
		description: "Internal event. Installations sync outside workflows.",
		toolbox: false,
	},
	{
		kind: "installation.deleted",
		name: "Installation deleted",
		description: "Internal event. Installations sync outside workflows.",
		toolbox: false,
	},
	{
		kind: "installation-repositories.added",
		name: "Repos added",
		description: "Internal event. Installations sync outside workflows.",
		toolbox: false,
	},
	{
		kind: "installation-repositories.removed",
		name: "Repos removed",
		description: "Internal event. Installations sync outside workflows.",
		toolbox: false,
	},
];

export interface GateCatalogEntry {
	mode: GateMode;
	name: string;
	description: string;
	toolbox: boolean;
}

export const GATE_CATALOG: GateCatalogEntry[] = [
	{
		mode: "all-of",
		name: "All of",
		description:
			"Passes only when every connected check passes. A check that was never reached does not pass.",
		toolbox: true,
	},
	{
		mode: "any-of",
		name: "Any of",
		description:
			"Passes when at least one connected check passes. A check that was never reached does not pass.",
		toolbox: true,
	},
	{
		mode: "not",
		name: "Not",
		description: "Flips its input: pass becomes fail, and fail becomes pass.",
		toolbox: true,
	},
	{
		mode: "unless",
		name: "Except when",
		description:
			"Passes when the requirement passes or the exception passes. Missing exception proof does not waive the requirement.",
		toolbox: false,
	},
];

export interface ActionCatalogEntry {
	action: WorkflowActionKind;
	name: string;
	description: string;
}

export const ACTION_CATALOG: ActionCatalogEntry[] = [
	{
		action: "block",
		name: "Block",
		description:
			"Fails the Tripwire check and requests changes. The change request stays open.",
	},
	{
		action: "request-fix",
		name: "Ask author to fix",
		description:
			"Fails the Tripwire check and tells the author what to change. No GitHub review.",
	},
	{
		action: "note",
		name: "Note only",
		description: "Leaves the check green and adds a note to the comment.",
	},
	{
		action: "label",
		name: "Label",
		description: "Adds labels you choose to the change request.",
	},
	{
		action: "request-review",
		name: "Request GitHub review",
		description: "Asks the people you choose to review on GitHub.",
	},
	{
		action: "send-to-moderation",
		name: "Human review",
		description: "Waits for a maintainer to approve or block it in Tripwire.",
	},
	{
		action: "webhook",
		name: "Webhook",
		description: "Posts the verdict as JSON to a URL you set.",
	},
	{
		action: "lock",
		name: "Lock",
		description: "Locks the conversation so only maintainers can comment.",
	},
	{
		action: "close",
		name: "Close",
		description: "Closes the issue or change request.",
	},
	{
		action: "remove-label",
		name: "Remove label",
		description: "Removes labels you choose, if they are there.",
	},
	{
		action: "post-comment",
		name: "Comment",
		description:
			"Posts a comment you write. It is separate from the verdict comment.",
	},
	{
		action: "discord",
		name: "Discord",
		description: "Posts the verdict to a Discord channel you set.",
	},
];
