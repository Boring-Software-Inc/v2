import { z } from "zod";
import { eventKindSchema } from "./events.ts";

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

export const gateModeSchema = z.enum(["all-of", "any-of", "not"]);
export type GateMode = z.infer<typeof gateModeSchema>;

export const workflowActionKindSchema = z.enum([
	"block",
	"comment",
	"label",
	"request-review",
	"send-to-moderation",
]);
export type WorkflowActionKind = z.infer<typeof workflowActionKindSchema>;

export const triggerNodeSchema = z.object({
	id: z.string(),
	type: z.literal("trigger"),
	kinds: z.array(eventKindSchema).min(1),
});

export const ruleNodeSchema = z.object({
	id: z.string(),
	type: z.literal("rule"),
	/** `id@version`, e.g. "account-age@1" — the versioning law (§6). */
	ref: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/),
	config: jsonValueSchema,
});

export const gateNodeSchema = z.object({
	id: z.string(),
	type: z.literal("gate"),
	mode: gateModeSchema,
});

export const actionNodeSchema = z.object({
	id: z.string(),
	type: z.literal("action"),
	action: workflowActionKindSchema,
	params: z.record(z.string(), jsonValueSchema).optional(),
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
 * The hand-seeded default workflow (§13.6) — used for any repo without its
 * own definitions, and as the editor's starting canvas. Boring thresholds;
 * per-repo tuning happens in the Rules UI / editor.
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
		{
			id: "ai-review",
			type: "rule",
			ref: "ai-review@1",
			config: { maxSteps: 12 },
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
		{ id: "e12", from: "trigger", to: "ai-review" },
		{ id: "e13", from: "ai-review", to: "gate" },
	],
};
