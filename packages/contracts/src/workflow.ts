import { z } from "zod";
import { type EventKind, eventKindSchema } from "./events.ts";

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
 * - a GATE node runs once ≥1 of its source nodes has settled (been reached) and
 *   aggregates their OUTCOMES — edge when-conduction does NOT gate gate
 *   execution, so a gate whose feeding rules all fail still runs and fails (the
 *   security fix; otherwise an all-failing gate would derive `pass`).
 * - rule nodes produce pass/fail; `skipped` conducts as pass but is recorded
 *   (a rule that can't evaluate must not block — §6 purity).
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

export const gateModeSchema = z.enum(["all-of", "any-of", "not"]);
export type GateMode = z.infer<typeof gateModeSchema>;

export const workflowActionKindSchema = z.enum([
	"block",
	"comment",
	"label",
	"request-review",
	"send-to-moderation",
	"webhook",
	"discord",
]);
export type WorkflowActionKind = z.infer<typeof workflowActionKindSchema>;

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

export const triggerNodeSchema = z.object({
	id: z.string(),
	type: z.literal("trigger"),
	kinds: z.array(eventKindSchema).min(1),
	position: nodePositionSchema.optional(),
});

export const ruleNodeSchema = z.object({
	id: z.string(),
	type: z.literal("rule"),
	/** `id@version`, e.g. "account-age@1" — the versioning law (§6). */
	ref: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/),
	config: jsonValueSchema,
	position: nodePositionSchema.optional(),
});

export const gateNodeSchema = z.object({
	id: z.string(),
	type: z.literal("gate"),
	mode: gateModeSchema,
	position: nodePositionSchema.optional(),
});

export const actionNodeSchema = z.object({
	id: z.string(),
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

export const workflowEdgeSchema = z.object({
	id: z.string(),
	from: z.string(),
	to: z.string(),
	/** Default: conducts on "pass". */
	when: edgeWhenSchema.optional(),
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
 * The hand-seeded default workflow (§13.6) — the BASELINE rule set a fresh
 * repo runs (derive.ts overlays toggles onto it) and the editor's starting
 * canvas. Boring thresholds; per-repo tuning happens in the Rules UI / editor.
 *
 * `ai-review@1` is deliberately ABSENT: it is opt-in per repo (§8 owner
 * decision — it costs tokens), so it is a NON-baseline rule that only runs
 * when a maintainer explicitly enables it. Keeping it out of the baseline is
 * what makes `ruleExecutes` (the /rules display) and `deriveDefaultWorkflow`
 * (execution) agree — both read this list.
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
		name: "change request opened",
		description: "Runs when someone opens a change request.",
		toolbox: true,
	},
	{
		kind: "change-request.updated",
		name: "change request updated",
		description: "Runs when a change request gets new commits or edits.",
		toolbox: true,
	},
	{
		kind: "change-request.closed",
		name: "change request closed",
		description: "Runs when a change request is closed.",
		toolbox: true,
	},
	{
		kind: "comment.created",
		name: "comment created",
		description: "Runs when someone comments on a change request or issue.",
		toolbox: true,
	},
	{
		kind: "push",
		name: "push",
		description: "Runs when commits are pushed to the repo.",
		toolbox: true,
	},
	{
		kind: "installation.created",
		name: "installation created",
		description: "Plumbing event — installations sync outside workflows.",
		toolbox: false,
	},
	{
		kind: "installation.deleted",
		name: "installation deleted",
		description: "Plumbing event — installations sync outside workflows.",
		toolbox: false,
	},
	{
		kind: "installation-repositories.added",
		name: "repos added",
		description: "Plumbing event — installations sync outside workflows.",
		toolbox: false,
	},
	{
		kind: "installation-repositories.removed",
		name: "repos removed",
		description: "Plumbing event — installations sync outside workflows.",
		toolbox: false,
	},
];

export interface GateCatalogEntry {
	mode: GateMode;
	name: string;
	description: string;
}

export const GATE_CATALOG: GateCatalogEntry[] = [
	{
		mode: "all-of",
		name: "all of",
		description: "Passes only when every connected check passes.",
	},
	{
		mode: "any-of",
		name: "any of",
		description: "Passes when at least one connected check passes.",
	},
	{
		mode: "not",
		name: "not",
		description: "Flips its input — pass becomes fail, fail becomes pass.",
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
		name: "block",
		description: "Blocks the change request with a request-changes review.",
	},
	{
		action: "comment",
		name: "comment",
		description: "Posts the run's verdict as a comment on the thread.",
	},
	{
		action: "label",
		name: "label",
		description: "Adds labels you choose to the change request.",
	},
	{
		action: "request-review",
		name: "request review",
		description: "Asks maintainers for a human review.",
	},
	{
		action: "send-to-moderation",
		name: "send to moderation",
		description: "Pauses here — a human decides in your moderation queue.",
	},
	{
		action: "webhook",
		name: "webhook",
		description: "Posts the verdict as json to a url you set.",
	},
	{
		action: "discord",
		name: "discord",
		description: "Posts the verdict to a discord channel you set.",
	},
];
