import { z } from "zod";
import { RULE_CATALOG } from "./rules.ts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	isRemovedAction,
	isScheduleTrigger,
	labelParamsSchema,
	missingScheduleSteps,
	type NodePosition,
	postCommentParamsSchema,
	type RemovedActionKind,
	type ReviewerRef,
	requestReviewParamsSchema,
	requestReviewTargetsSchema,
	reviewerJson,
	type ScheduleStep,
	sameReviewer,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
	workflowDefinitionSchema,
	workflowNodeSchema,
} from "./workflow.ts";
import {
	canAccept,
	edgePort,
	outputPorts,
	WORKFLOW_PORT_KIND,
	WORKFLOW_PORT_LABELS,
	type WorkflowPort,
} from "./workflow-connections.ts";

export interface ValidationCatalogEntry {
	ruleId: string;
	version: number;
	name: string;
	configSchema: z.ZodType;
}

export type LintSeverity = "error" | "warning";
export type LintStage = "structure" | "enable";

export const LINT_RULES = {
	schema: { severity: "error", stage: "structure" },
	"no-trigger-events": { severity: "error", stage: "structure" },
	"duplicate-id": { severity: "error", stage: "structure" },
	"missing-step": { severity: "error", stage: "structure" },
	"no-trigger": { severity: "error", stage: "structure" },
	"trigger-input": { severity: "error", stage: "structure" },
	"gate-input": { severity: "error", stage: "structure" },
	"no-outputs": { severity: "error", stage: "structure" },
	"wrong-output": { severity: "error", stage: "structure" },
	"not-input": { severity: "error", stage: "structure" },
	"orphan-step": { severity: "error", stage: "structure" },
	cycle: { severity: "error", stage: "structure" },
	"no-action": { severity: "error", stage: "enable" },
	"schedule-config": { severity: "error", stage: "enable" },
	"action-params": { severity: "error", stage: "enable" },
	"schedule-mixed": { severity: "error", stage: "enable" },
	"schedule-needs-change-request": { severity: "error", stage: "enable" },
	"unknown-rule": { severity: "error", stage: "enable" },
	"rule-config": { severity: "error", stage: "enable" },
	"removed-step": { severity: "error", stage: "enable" },
	"review-targets": { severity: "error", stage: "enable" },
	"stale-reviewer": { severity: "warning", stage: "enable" },
	"dead-end": { severity: "warning", stage: "enable" },
} as const satisfies Record<
	string,
	{ severity: LintSeverity; stage: LintStage }
>;

export type LintRuleId = keyof typeof LINT_RULES;

export type LintEdit =
	| { type: "remove-edge"; edgeId: string }
	| { type: "use-passes"; edgeId: string }
	| { type: "insert-not"; edgeId: string }
	| { type: "delete-node"; nodeId: string }
	| { type: "connect"; from: string; to: string }
	| { type: "keep-one-input"; nodeId: string; edgeId: string }
	| { type: "remove-reviewer"; nodeId: string; reviewer: ReviewerRef }
	| { type: "add-trigger" };

export type LintIntent =
	| { type: "focus-field"; nodeId: string; field: string }
	| { type: "insert-step"; edgeId: string }
	| { type: "add-next-step"; nodeId: string; port: WorkflowPort };

export type LintFix =
	| { label: string; edit: LintEdit }
	| { label: string; intent: LintIntent };

export interface LintResult {
	rule: LintRuleId;
	severity: LintSeverity;
	step: string;
	message: string;
	nodeId?: string;
	edgeId?: string;
	fixes: LintFix[];
}

export interface ConnectionHint {
	rule: LintRuleId;
	message: string;
}

export interface LintOptions {
	catalog?: readonly ValidationCatalogEntry[];
	stage?: LintStage;
	reviewers?: readonly ReviewerRef[];
}

type Finding = Omit<LintResult, "rule" | "severity" | "step">;
type GateNode = Extract<WorkflowNode, { type: "gate" }>;
type TriggerNode = Extract<WorkflowNode, { type: "trigger" }>;

interface LintContext {
	def: WorkflowDefinition;
	byId: Map<string, WorkflowNode>;
	incoming: Map<string, WorkflowEdge[]>;
	outgoing: Map<string, WorkflowEdge[]>;
	name: (node: WorkflowNode) => string;
	catalog: readonly ValidationCatalogEntry[];
	reviewers?: readonly ReviewerRef[];
}

const removeEdge = (edgeId: string): LintFix => ({
	label: "Remove connection",
	edit: { type: "remove-edge", edgeId },
});

const deleteStep = (nodeId: string): LintFix => ({
	label: "Delete",
	edit: { type: "delete-node", nodeId },
});

function withPeriod(text: string): string {
	const trimmed = text.trim();
	return /[.?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function sentence(text: string): string {
	const trimmed = text.trim();
	return withPeriod(`${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`);
}

function sentenceList(names: string[]): string {
	if (names.length <= 1) {
		return names.join("");
	}
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function stepDisplayName(
	node: WorkflowNode,
	catalog: readonly ValidationCatalogEntry[] = RULE_CATALOG,
): string {
	switch (node.type) {
		case "trigger":
			return "Trigger";
		case "rule": {
			const [ruleId] = node.ref.split("@");
			return (
				RULE_CATALOG.find((entry) => entry.ruleId === ruleId)?.name ??
				catalog.find((entry) => entry.ruleId === ruleId)?.name ??
				node.ref
			);
		}
		case "gate":
			return (
				GATE_CATALOG.find((entry) => entry.mode === node.mode)?.name ??
				node.mode
			);
		case "action":
			return (
				ACTION_CATALOG.find((entry) => entry.action === node.action)?.name ??
				`${node.action.charAt(0).toUpperCase()}${node.action.slice(1)}`
			);
		default:
			return "Step";
	}
}

export function portHint(
	target: WorkflowNode,
	port: WorkflowPort,
	targetName: string,
	sourceName?: string,
): ConnectionHint | null {
	if (canAccept(target.type, port)) {
		return null;
	}
	if (target.type === "trigger") {
		return {
			rule: "trigger-input",
			message: sourceName
				? `${targetName} takes no inputs, but ${sourceName} connects to it`
				: `${targetName} takes no inputs`,
		};
	}
	const from = sourceName ? ` from ${sourceName}` : "";
	const kind = WORKFLOW_PORT_KIND[port];
	const message =
		kind === "result"
			? `${targetName} takes only Passes, not ${WORKFLOW_PORT_LABELS[port]}${from}`
			: `${targetName} takes rule results, not ${kind === "event" ? "events" : "decisions"}${from}`;
	return { rule: "gate-input", message };
}

export function outputHint(
	source: WorkflowNode,
	port: WorkflowPort,
	sourceName: string,
): ConnectionHint | null {
	const outputs = outputPorts(source);
	if (outputs.length === 0) {
		return { rule: "no-outputs", message: `${sourceName} has no outputs` };
	}
	if (!outputs.includes(port)) {
		return {
			rule: "wrong-output",
			message: `${sourceName} has no ${WORKFLOW_PORT_LABELS[port]} output`,
		};
	}
	return null;
}

function gateInputMessage(port: WorkflowPort): string {
	const kind = WORKFLOW_PORT_KIND[port];
	if (kind === "result") {
		return "It takes only Passes.";
	}
	return kind === "event"
		? "It takes rule results, not events."
		: "It takes rule results, not decisions.";
}

export function stepNames(
	def: Pick<WorkflowDefinition, "nodes">,
	catalog: readonly ValidationCatalogEntry[] = RULE_CATALOG,
): Map<string, string> {
	const seen = new Map<string, number>();
	const names = new Map<string, string>();
	for (const node of def.nodes) {
		const base = stepDisplayName(node, catalog);
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		names.set(node.id, count === 1 ? base : `${base} ${count}`);
	}
	return names;
}

function gateInputFixes(edge: WorkflowEdge, port: WorkflowPort): LintFix[] {
	if (port === "event") {
		return [
			{
				label: "Insert a rule",
				intent: { type: "insert-step", edgeId: edge.id },
			},
			removeEdge(edge.id),
		];
	}
	if (WORKFLOW_PORT_KIND[port] === "result") {
		return [
			{
				label: "Insert a Not gate",
				edit: { type: "insert-not", edgeId: edge.id },
			},
			{ label: "Use Passes", edit: { type: "use-passes", edgeId: edge.id } },
		];
	}
	return [removeEdge(edge.id)];
}

function checkDuplicateIds(ctx: LintContext): Finding[] {
	const findings: Finding[] = [];
	const seenNodes = new Set<string>();
	for (const node of ctx.def.nodes) {
		if (seenNodes.has(node.id)) {
			findings.push({
				nodeId: node.id,
				message: "Another step uses the same id. Rename one.",
				fixes: [],
			});
		}
		seenNodes.add(node.id);
	}
	const seenEdges = new Set<string>();
	for (const edge of ctx.def.edges) {
		if (seenEdges.has(edge.id)) {
			findings.push({
				edgeId: edge.id,
				message: "Another connection uses the same id. Rename one.",
				fixes: [],
			});
		}
		seenEdges.add(edge.id);
	}
	return findings;
}

function checkMissingSteps(ctx: LintContext): Finding[] {
	return ctx.def.edges.flatMap((edge) =>
		[edge.from, edge.to]
			.filter((id) => !ctx.byId.has(id))
			.map(() => ({
				edgeId: edge.id,
				message: "A connection points to a step that is gone.",
				fixes: [removeEdge(edge.id)],
			})),
	);
}

function checkNoTrigger(ctx: LintContext): Finding[] {
	return ctx.def.nodes.some((node) => node.type === "trigger")
		? []
		: [
				{
					message: "Add a trigger to start it.",
					fixes: [{ label: "Add trigger", edit: { type: "add-trigger" } }],
				},
			];
}

function edgeEnds(ctx: LintContext, edge: WorkflowEdge) {
	const source = ctx.byId.get(edge.from);
	const target = ctx.byId.get(edge.to);
	return source && target ? { source, target } : null;
}

function checkPortInputs(rule: "trigger-input" | "gate-input") {
	return (ctx: LintContext): Finding[] =>
		ctx.def.edges.flatMap((edge) => {
			const ends = edgeEnds(ctx, edge);
			if (
				!ends ||
				outputHint(ends.source, edgePort(ends.source, edge.when), "")
			) {
				return [];
			}
			const port = edgePort(ends.source, edge.when);
			const hint = portHint(
				ends.target,
				port,
				ctx.name(ends.target),
				ctx.name(ends.source),
			);
			if (hint?.rule !== rule) {
				return [];
			}
			return [
				{
					edgeId: edge.id,
					nodeId: ends.target.id,
					message:
						rule === "gate-input"
							? gateInputMessage(port)
							: "It takes no inputs.",
					fixes:
						rule === "gate-input"
							? gateInputFixes(edge, port)
							: [removeEdge(edge.id)],
				},
			];
		});
}

function checkOutputs(rule: "no-outputs" | "wrong-output") {
	return (ctx: LintContext): Finding[] =>
		ctx.def.edges.flatMap((edge) => {
			const ends = edgeEnds(ctx, edge);
			if (!ends) {
				return [];
			}
			const hint = outputHint(
				ends.source,
				edgePort(ends.source, edge.when),
				ctx.name(ends.source),
			);
			if (hint?.rule !== rule) {
				return [];
			}
			const canPass = outputPorts(ends.source).includes("pass");
			return [
				{
					edgeId: edge.id,
					nodeId: ends.source.id,
					message:
						rule === "no-outputs"
							? "It has no outputs."
							: `It has no ${WORKFLOW_PORT_LABELS[edgePort(ends.source, edge.when)]} output.`,
					fixes:
						rule === "wrong-output" && canPass
							? [
									{
										label: "Use Passes",
										edit: { type: "use-passes", edgeId: edge.id },
									},
									removeEdge(edge.id),
								]
							: [removeEdge(edge.id)],
				},
			];
		});
}

function checkNotInputs(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) => {
		const incoming = ctx.incoming.get(node.id) ?? [];
		const [first] = incoming;
		if (
			node.type !== "gate" ||
			node.mode !== "not" ||
			incoming.length < 2 ||
			!first
		) {
			return [];
		}
		return [
			{
				nodeId: node.id,
				message: "It takes one input. Keep one.",
				fixes: [
					{
						label: "Keep first input",
						edit: { type: "keep-one-input", nodeId: node.id, edgeId: first.id },
					},
				],
			},
		];
	});
}

function checkOrphans(ctx: LintContext): Finding[] {
	const triggers = ctx.def.nodes.filter((node) => node.type === "trigger");
	const [onlyTrigger] = triggers;
	return ctx.def.nodes.flatMap((node) => {
		if (
			node.type === "trigger" ||
			(ctx.incoming.get(node.id) ?? []).length > 0
		) {
			return [];
		}
		const connect: LintFix[] =
			triggers.length === 1 && onlyTrigger && canAccept(node.type, "event")
				? [
						{
							label: "Connect",
							edit: { type: "connect", from: onlyTrigger.id, to: node.id },
						},
					]
				: [];
		return [
			{
				nodeId: node.id,
				message: "Nothing runs it. Connect it or delete it.",
				fixes: [...connect, deleteStep(node.id)],
			},
		];
	});
}

function checkCycles(ctx: LintContext): Finding[] {
	const state = new Map<string, "visiting" | "done">();
	const path: string[] = [];
	const findings: Finding[] = [];
	const visit = (id: string) => {
		state.set(id, "visiting");
		path.push(id);
		for (const edge of ctx.outgoing.get(id) ?? []) {
			const next = state.get(edge.to);
			if (next === "visiting") {
				const loop = path.slice(path.indexOf(edge.to));
				const names = loop.flatMap((step) => {
					const node = ctx.byId.get(step);
					return node ? [ctx.name(node)] : [];
				});
				findings.push({
					edgeId: edge.id,
					nodeId: edge.to,
					message:
						names.length === 1
							? "It connects to itself."
							: `It loops back through ${sentenceList(names.slice(1))}.`,
					fixes: [removeEdge(edge.id)],
				});
			} else if (next === undefined && ctx.byId.has(edge.to)) {
				visit(edge.to);
			}
		}
		path.pop();
		state.set(id, "done");
	};
	for (const node of ctx.def.nodes) {
		if (!state.has(node.id)) {
			visit(node.id);
		}
	}
	return findings;
}

function reachableFromTriggers(ctx: LintContext): Set<string> {
	return reachableFrom(
		ctx,
		ctx.def.nodes
			.filter((node) => node.type === "trigger")
			.map((node) => node.id),
	);
}

function checkNoAction(ctx: LintContext): Finding[] {
	const reached = reachableFromTriggers(ctx);
	const firstTrigger = ctx.def.nodes.find((node) => node.type === "trigger");
	return ctx.def.nodes.some(
		(node) => node.type === "action" && reached.has(node.id),
	)
		? []
		: [
				{
					message: "Add an action after the trigger.",
					fixes: firstTrigger
						? [
								{
									label: "Add action",
									intent: {
										type: "add-next-step",
										nodeId: firstTrigger.id,
										port: "event",
									},
								},
							]
						: [],
				},
			];
}

const SCHEDULE_STEP_WORDS = {
	every: "how often it runs",
	subjects: "what it looks at",
	state: "a status",
	inactiveFor: "how long without activity",
} as const satisfies Record<ScheduleStep, string>;

function checkScheduleConfig(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) => {
		if (node.type !== "trigger" || !isScheduleTrigger(node)) {
			return [];
		}
		const missing = missingScheduleSteps(node.schedule);
		if (missing.length === 0) {
			return [];
		}
		const [first] = missing;
		return [
			{
				nodeId: node.id,
				message: `Set ${sentenceList(missing.map((step) => SCHEDULE_STEP_WORDS[step]))}.`,
				fixes: [
					{
						label: "Set schedule",
						intent: {
							type: "focus-field",
							nodeId: node.id,
							field: first ?? "schedule",
						},
					},
				],
			},
		];
	});
}

const ACTION_PARAM_SCHEMAS = {
	"remove-label": {
		schema: labelParamsSchema,
		field: "labels",
		message: "Pick the labels to remove.",
		label: "Pick labels",
	},
	"post-comment": {
		schema: postCommentParamsSchema,
		field: "message",
		message: "Write the message.",
		label: "Write message",
	},
} as const;

function checkActionParams(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) => {
		if (node.type !== "action") {
			return [];
		}
		const spec =
			node.action === "remove-label" || node.action === "post-comment"
				? ACTION_PARAM_SCHEMAS[node.action]
				: null;
		const parsed = spec?.schema.safeParse(node.params ?? {});
		if (!(spec && parsed) || parsed.success) {
			return [];
		}
		return [
			{
				nodeId: node.id,
				message: spec.message,
				fixes: [
					{
						label: spec.label,
						intent: { type: "focus-field", nodeId: node.id, field: spec.field },
					},
				],
			},
		];
	});
}

function checkScheduleMixed(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) =>
		node.type === "trigger" && isScheduleTrigger(node) && node.kinds.length > 1
			? [
					{
						nodeId: node.id,
						message: "It cannot run on a schedule and on events. Pick one.",
						fixes: [
							{
								label: "Pick one",
								intent: {
									type: "focus-field",
									nodeId: node.id,
									field: "kinds",
								},
							},
						],
					},
				]
			: [],
	);
}

const CHANGE_REQUEST_ONLY_ACTIONS = new Set(["block", "send-to-moderation"]);

function reachableFrom(ctx: LintContext, startIds: string[]): Set<string> {
	const reached = new Set<string>();
	const queue = [...startIds];
	for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
		if (reached.has(id)) {
			continue;
		}
		reached.add(id);
		queue.push(...(ctx.outgoing.get(id) ?? []).map((edge) => edge.to));
	}
	return reached;
}

function checkScheduleActions(ctx: LintContext): Finding[] {
	const reached = reachableFrom(
		ctx,
		ctx.def.nodes.filter(isScheduleTrigger).map((node) => node.id),
	);
	return ctx.def.nodes.flatMap((node) =>
		node.type === "action" &&
		reached.has(node.id) &&
		CHANGE_REQUEST_ONLY_ACTIONS.has(node.action)
			? [
					{
						nodeId: node.id,
						message:
							"It needs a change request event. A schedule cannot run it.",
						fixes: [deleteStep(node.id)],
					},
				]
			: [],
	);
}

function catalogEntry(ctx: LintContext, ref: string) {
	const [ruleId, version] = ref.split("@");
	return ctx.catalog.find(
		(entry) => entry.ruleId === ruleId && entry.version === Number(version),
	);
}

function checkUnknownRules(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) =>
		node.type === "rule" && !catalogEntry(ctx, node.ref)
			? [
					{
						nodeId: node.id,
						message: "This rule is not in this repo.",
						fixes: [deleteStep(node.id)],
					},
				]
			: [],
	);
}

function checkRuleConfigs(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) => {
		if (node.type !== "rule") {
			return [];
		}
		const entry = catalogEntry(ctx, node.ref);
		const parsed = entry?.configSchema.safeParse(node.config);
		if (!(entry && parsed) || parsed.success) {
			return [];
		}
		const issue = parsed.error.issues[0];
		const field = issue?.path[0];
		return [
			{
				nodeId: node.id,
				message: issue?.message
					? `Fix this setting: ${withPeriod(issue.message)}`
					: "A setting is not valid.",
				fixes:
					field === undefined
						? []
						: [
								{
									label: "Edit setting",
									intent: {
										type: "focus-field",
										nodeId: node.id,
										field: String(field),
									},
								},
							],
			},
		];
	});
}

const REMOVED_STEP_REASONS = {
	comment: "Customize sets the verdict comment now",
	discord: "delete it to turn this workflow on",
} as const satisfies Record<RemovedActionKind, string>;

function checkRemovedSteps(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) =>
		node.type === "action" && isRemovedAction(node.action)
			? [
					{
						nodeId: node.id,
						message: `This step was removed. ${sentence(REMOVED_STEP_REASONS[node.action])}`,
						fixes: [deleteStep(node.id)],
					},
				]
			: [],
	);
}

function checkReviewTargets(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) => {
		if (node.type !== "action" || node.action !== "request-review") {
			return [];
		}
		const parsed = requestReviewParamsSchema.safeParse(node.params ?? {});
		if (parsed.success) {
			return [];
		}
		const issue = parsed.error.issues[0];
		const empty =
			issue?.code === "custom" &&
			issue.path.length === 0 &&
			issue.message.startsWith("add");
		const field =
			issue?.path[0] === "teamReviewers" ? "teamReviewers" : "reviewers";
		return [
			{
				nodeId: node.id,
				message: empty
					? "Pick people or teams to ask."
					: issue?.message
						? `Fix the reviewers: ${withPeriod(issue.message)}`
						: "A reviewer is not valid.",
				fixes: [
					{
						label: empty ? "Add reviewers" : "Edit reviewers",
						intent: { type: "focus-field", nodeId: node.id, field },
					},
				],
			},
		];
	});
}

function checkStaleReviewers(ctx: LintContext): Finding[] {
	const synced = ctx.reviewers;
	if (!synced) {
		return [];
	}
	return ctx.def.nodes.flatMap((node) => {
		if (node.type !== "action" || node.action !== "request-review") {
			return [];
		}
		const parsed = requestReviewTargetsSchema.safeParse(node.params ?? {});
		if (!parsed.success) {
			return [];
		}
		return parsed.data.reviewers
			.filter((chosen) => !synced.some((known) => sameReviewer(known, chosen)))
			.map((reviewer) => ({
				nodeId: node.id,
				message: `Remove ${reviewer.login}. They can no longer review this repo.`,
				fixes: [
					{
						label: "Remove",
						edit: { type: "remove-reviewer", nodeId: node.id, reviewer },
					},
				],
			}));
	});
}

function checkDeadEnds(ctx: LintContext): Finding[] {
	return ctx.def.nodes.flatMap((node) => {
		const [port] = outputPorts(node);
		if (
			node.type === "action" ||
			!port ||
			(ctx.outgoing.get(node.id) ?? []).length > 0 ||
			(node.type !== "trigger" &&
				(ctx.incoming.get(node.id) ?? []).length === 0)
		) {
			return [];
		}
		return [
			{
				nodeId: node.id,
				message: "Nothing runs after it.",
				fixes: [
					{
						label: "Add step",
						intent: { type: "add-next-step", nodeId: node.id, port },
					},
					deleteStep(node.id),
				],
			},
		];
	});
}

type CheckedRule = Exclude<LintRuleId, "schema" | "no-trigger-events">;

const CHECKS: { rule: CheckedRule; check: (ctx: LintContext) => Finding[] }[] =
	[
		{ rule: "duplicate-id", check: checkDuplicateIds },
		{ rule: "missing-step", check: checkMissingSteps },
		{ rule: "no-trigger", check: checkNoTrigger },
		{ rule: "trigger-input", check: checkPortInputs("trigger-input") },
		{ rule: "gate-input", check: checkPortInputs("gate-input") },
		{ rule: "no-outputs", check: checkOutputs("no-outputs") },
		{ rule: "wrong-output", check: checkOutputs("wrong-output") },
		{ rule: "not-input", check: checkNotInputs },
		{ rule: "orphan-step", check: checkOrphans },
		{ rule: "cycle", check: checkCycles },
		{ rule: "no-action", check: checkNoAction },
		{ rule: "schedule-config", check: checkScheduleConfig },
		{ rule: "action-params", check: checkActionParams },
		{ rule: "schedule-mixed", check: checkScheduleMixed },
		{
			rule: "schedule-needs-change-request",
			check: checkScheduleActions,
		},
		{ rule: "unknown-rule", check: checkUnknownRules },
		{ rule: "rule-config", check: checkRuleConfigs },
		{ rule: "removed-step", check: checkRemovedSteps },
		{ rule: "review-targets", check: checkReviewTargets },
		{ rule: "stale-reviewer", check: checkStaleReviewers },
		{ rule: "dead-end", check: checkDeadEnds },
	];

function group(edges: WorkflowEdge[], key: "from" | "to") {
	const map = new Map<string, WorkflowEdge[]>();
	for (const edge of edges) {
		map.set(edge[key], [...(map.get(edge[key]) ?? []), edge]);
	}
	return map;
}

function result(
	rule: LintRuleId,
	finding: Finding,
	names: ReadonlyMap<string, string> = new Map(),
): LintResult {
	return {
		rule,
		severity: LINT_RULES[rule].severity,
		step: finding.nodeId ? (names.get(finding.nodeId) ?? "Step") : "Workflow",
		...finding,
	};
}

function lintParsed(
	def: WorkflowDefinition,
	catalog: readonly ValidationCatalogEntry[],
	stage: LintStage,
	reviewers?: readonly ReviewerRef[],
): LintResult[] {
	const names = stepNames(def, catalog);
	const ctx: LintContext = {
		def,
		byId: new Map(def.nodes.map((node) => [node.id, node])),
		incoming: group(def.edges, "to"),
		outgoing: group(def.edges, "from"),
		name: (node) => names.get(node.id) ?? stepDisplayName(node, catalog),
		catalog,
		reviewers,
	};
	return CHECKS.flatMap(({ rule, check }) =>
		stage === "structure" && LINT_RULES[rule].stage !== "structure"
			? []
			: check(ctx).map((finding) => result(rule, finding, names)),
	);
}

const rawGraphSchema = z.object({
	nodes: z.array(
		z.looseObject({
			id: z.string().catch(""),
			type: z.string().catch(""),
			kinds: z.array(z.string()).optional().catch(undefined),
		}),
	),
});

function rawStepNames(
	rawNodes: readonly { id: string; type: string }[],
	catalog: readonly ValidationCatalogEntry[],
): Map<string, string> {
	const seen = new Map<string, number>();
	const names = new Map<string, string>();
	for (const raw of rawNodes) {
		const parsed = workflowNodeSchema.safeParse(raw);
		const base = parsed.success
			? stepDisplayName(parsed.data, catalog)
			: raw.type
				? `${raw.type.charAt(0).toUpperCase()}${raw.type.slice(1)}`
				: "Step";
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		names.set(raw.id, count === 1 ? base : `${base} ${count}`);
	}
	return names;
}

function schemaResults(
	error: z.ZodError,
	ids: string[],
	names: ReadonlyMap<string, string>,
): LintResult[] {
	return error.issues.map((issue) => {
		const [head, index] = issue.path;
		const nodeId =
			head === "nodes" && Number.isInteger(index)
				? ids[Number(index)]
				: undefined;
		return result(
			"schema",
			{
				nodeId: nodeId || undefined,
				message: "A setting is not valid.",
				fixes: [],
			},
			names,
		);
	});
}

export interface LintReport {
	definition: WorkflowDefinition | null;
	results: LintResult[];
}

export function lintWorkflowReport(
	definition: WorkflowDefinition,
	options: LintOptions = {},
): LintReport {
	const catalog = options.catalog ?? RULE_CATALOG;
	const stage = options.stage ?? "enable";
	const sorted = (results: LintResult[]) =>
		[...results].sort(
			(a, b) =>
				Number(a.severity === "warning") - Number(b.severity === "warning"),
		);
	const parsed = workflowDefinitionSchema.safeParse(definition);
	if (parsed.success) {
		return {
			definition: parsed.data,
			results: sorted(
				lintParsed(parsed.data, catalog, stage, options.reviewers),
			),
		};
	}
	const raw = rawGraphSchema.safeParse(definition);
	const rawNodes = raw.success ? raw.data.nodes : [];
	const silent = rawNodes.filter(
		(node) => node.type === "trigger" && node.kinds?.length === 0,
	);
	const patched = workflowDefinitionSchema.safeParse({
		...definition,
		nodes: rawNodes.map((node) =>
			silent.includes(node) ? { ...node, kinds: ["push"] } : node,
		),
	});
	if (silent.length === 0 || !patched.success) {
		return {
			definition: null,
			results: schemaResults(
				parsed.error,
				rawNodes.map((node) => node.id),
				rawStepNames(rawNodes, catalog),
			),
		};
	}
	const patchedNames = stepNames(patched.data, catalog);
	const silentResults = silent.map((node) =>
		result(
			"no-trigger-events",
			{
				nodeId: node.id,
				message: "Pick when it runs.",
				fixes: [
					{
						label: "Pick events",
						intent: { type: "focus-field", nodeId: node.id, field: "kinds" },
					},
				],
			},
			patchedNames,
		),
	);
	return {
		definition: null,
		results: sorted([
			...silentResults,
			...lintParsed(patched.data, catalog, stage, options.reviewers),
		]),
	};
}

export function lintWorkflow(
	definition: WorkflowDefinition,
	options: LintOptions = {},
): LintResult[] {
	return lintWorkflowReport(definition, options).results;
}

function freshId(def: WorkflowDefinition, prefix: string): string {
	const taken = new Set([
		...def.nodes.map((node) => node.id),
		...def.edges.map((edge) => edge.id),
	]);
	let index = 1;
	while (taken.has(`${prefix}-${index}`)) {
		index++;
	}
	return `${prefix}-${index}`;
}

const STEP_BOX = { width: 240, height: 120 };
const STEP_NUDGE = 60;

export function openPosition(
	def: WorkflowDefinition,
	preferred: NodePosition,
): NodePosition {
	const placed = def.nodes.flatMap((node) =>
		node.position ? [node.position] : [],
	);
	const free = (y: number) =>
		!placed.some(
			(p) =>
				Math.abs(p.x - preferred.x) < STEP_BOX.width &&
				Math.abs(p.y - y) < STEP_BOX.height,
		);
	for (let step = 0; step <= placed.length * 4; step++) {
		const offset = Math.ceil(step / 2) * (step % 2 === 0 ? -1 : 1) * STEP_NUDGE;
		if (free(preferred.y + offset)) {
			return { x: preferred.x, y: preferred.y + offset };
		}
	}
	return preferred;
}

function between(
	def: WorkflowDefinition,
	a: NodePosition | undefined,
	b: NodePosition | undefined,
): NodePosition | undefined {
	return a && b
		? openPosition(def, {
				x: Math.round((a.x + b.x) / 2),
				y: Math.round((a.y + b.y) / 2),
			})
		: undefined;
}

function withoutWhen(edge: WorkflowEdge): WorkflowEdge {
	return { id: edge.id, from: edge.from, to: edge.to };
}

export function insertStep(
	def: WorkflowDefinition,
	edgeId: string,
	node: WorkflowNode,
): WorkflowDefinition {
	const edge = def.edges.find((entry) => entry.id === edgeId);
	if (!edge) {
		return def;
	}
	const withNode = { ...def, nodes: [...def.nodes, node] };
	const into: WorkflowEdge = {
		...edge,
		id: freshId(withNode, "edge"),
		to: node.id,
	};
	const out: WorkflowEdge = {
		id: freshId({ ...withNode, edges: [...def.edges, into] }, "edge"),
		from: node.id,
		to: edge.to,
	};
	return {
		...withNode,
		edges: [...def.edges.filter((entry) => entry.id !== edgeId), into, out],
	};
}

export function applyLintEdit(
	def: WorkflowDefinition,
	edit: LintEdit,
): WorkflowDefinition {
	switch (edit.type) {
		case "remove-edge":
			return {
				...def,
				edges: def.edges.filter((edge) => edge.id !== edit.edgeId),
			};
		case "use-passes":
			return {
				...def,
				edges: def.edges.map((edge) =>
					edge.id === edit.edgeId ? withoutWhen(edge) : edge,
				),
			};
		case "insert-not": {
			const edge = def.edges.find((entry) => entry.id === edit.edgeId);
			if (!edge) {
				return def;
			}
			const position = between(
				def,
				def.nodes.find((node) => node.id === edge.from)?.position,
				def.nodes.find((node) => node.id === edge.to)?.position,
			);
			const not: GateNode = {
				id: freshId(def, "not"),
				type: "gate",
				mode: "not",
			};
			if (position) {
				not.position = position;
			}
			return insertStep(
				{
					...def,
					edges: def.edges.map((entry) =>
						entry.id === edge.id ? withoutWhen(entry) : entry,
					),
				},
				edge.id,
				not,
			);
		}
		case "delete-node":
			return {
				...def,
				nodes: def.nodes.filter((node) => node.id !== edit.nodeId),
				edges: def.edges.filter(
					(edge) => edge.from !== edit.nodeId && edge.to !== edit.nodeId,
				),
			};
		case "connect":
			return {
				...def,
				edges: [
					...def.edges,
					{ id: freshId(def, "edge"), from: edit.from, to: edit.to },
				],
			};
		case "keep-one-input":
			return {
				...def,
				edges: def.edges.filter(
					(edge) => edge.to !== edit.nodeId || edge.id === edit.edgeId,
				),
			};
		case "remove-reviewer":
			return {
				...def,
				nodes: def.nodes.map((node) => {
					if (node.id !== edit.nodeId || node.type !== "action") {
						return node;
					}
					const parsed = requestReviewTargetsSchema.safeParse(
						node.params ?? {},
					);
					if (!parsed.success) {
						return node;
					}
					return {
						...node,
						params: {
							...node.params,
							reviewers: reviewerJson(
								parsed.data.reviewers.filter(
									(reviewer) => !sameReviewer(reviewer, edit.reviewer),
								),
							),
						},
					};
				}),
			};
		case "add-trigger": {
			const placed = def.nodes.flatMap((node) =>
				node.position ? [node.position] : [],
			);
			const trigger: TriggerNode = {
				id: freshId(def, "trigger"),
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
			};
			if (placed.length > 0) {
				trigger.position = {
					x: Math.min(...placed.map((p) => p.x)) - 300,
					y: Math.min(...placed.map((p) => p.y)),
				};
			}
			return { ...def, nodes: [trigger, ...def.nodes] };
		}
		default:
			return def;
	}
}
