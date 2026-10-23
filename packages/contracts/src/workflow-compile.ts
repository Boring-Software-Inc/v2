import { z } from "zod";
import { type EventKind, eventKindSchema } from "./events.ts";
import { RULE_CATALOG } from "./rules.ts";
import {
	type EdgeWhen,
	jsonValueSchema,
	triggerScheduleSchema,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
	workflowDefinitionSchema,
} from "./workflow.ts";
import type {
	ActionStep,
	CheckStep,
	GateStep,
	Input,
	Output,
	OutputPort,
	ReviewStep,
	Settings,
	SettingValue,
	Step,
	TriggerStep,
	WorkflowSpec,
} from "./workflow-authoring.ts";
import {
	AUTHORING_ACTION_PARAMS,
	AUTHORING_EVENT_KINDS,
	type AuthoringActionKind,
} from "./workflow-authoring-catalog.ts";
import {
	type LintResult,
	lintWorkflow,
	type ValidationCatalogEntry,
} from "./workflow-lint.ts";
import { describeSchedule, scheduleZone } from "./workflow-schedule.ts";

export interface CompileIssue {
	workflow: string;
	step?: string;
	message: string;
}

export type CompileResult =
	| { ok: true; definitions: WorkflowDefinition[] }
	| { ok: false; issues: CompileIssue[] };

function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		let previous = row[0] ?? 0;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const above = row[j] ?? 0;
			row[j] = Math.min(
				above + 1,
				(row[j - 1] ?? 0) + 1,
				previous + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			previous = above;
		}
	}
	return row[b.length] ?? 0;
}

function isSubsequence(short: string, long: string): boolean {
	let index = 0;
	for (const char of long) {
		if (char === short[index]) {
			index++;
		}
	}
	return index === short.length;
}

function normalize(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The closest valid id, when one is close enough to be the intended one. */
export function didYouMean(
	given: string,
	valid: readonly string[],
): string | null {
	const target = normalize(given);
	let best: { id: string; score: number } | null = null;
	for (const id of valid) {
		const candidate = normalize(id);
		const contained =
			isSubsequence(target, candidate) || isSubsequence(candidate, target);
		const score = contained
			? Math.abs(candidate.length - target.length) / 4
			: distance(target, candidate);
		if (best === null || score < best.score) {
			best = { id, score };
		}
	}
	if (!best) {
		return null;
	}
	const limit = Math.max(2, Math.ceil(target.length / 3));
	return best.score <= limit ? best.id : null;
}

function unknownMessage(
	what: string,
	given: string,
	valid: readonly string[],
): string {
	const guess = didYouMean(given, valid);
	return guess
		? `${given} is not ${what}. Did you mean ${guess}?`
		: `${given} is not ${what}. Use one of: ${valid.join(", ")}`;
}

const objectSchema = z.record(z.string(), z.unknown());

export function settingsIssues(
	given: Settings | undefined,
	schema: z.ZodType,
	what: string,
): string[] {
	const record = objectSchema.safeParse(given ?? {});
	if (!record.success) {
		return [`${what} takes an object of settings`];
	}
	const known =
		schema instanceof z.ZodObject ? Object.keys(schema.shape) : null;
	const extra = known
		? Object.keys(record.data).filter((key) => !known.includes(key))
		: [];
	if (extra.length > 0 && known) {
		return extra.map((key) =>
			unknownMessage(`a setting of ${what}`, key, known),
		);
	}
	const parsed = schema.safeParse(record.data);
	return parsed.success
		? []
		: parsed.error.issues.map((issue) =>
				issue.path.length > 0
					? `${what}: ${issue.path.join(".")}: ${issue.message}`
					: `${what}: ${issue.message}`,
			);
}

const inputShape = z.object({
	kind: z.enum(["trigger", "check", "gate", "action", "output"]),
});

const stepShape = z.object({
	kind: z.enum(["trigger", "check", "gate", "action"]),
});
const outputShape = z.object({
	kind: z.literal("output"),
	port: z.enum(["pass", "fail", "approve", "deny"]),
});
const specShape = z.object({}).loose();

const triggerStepSchema = z.custom<TriggerStep>(
	(step) => stepShape.safeParse(step).success,
);

/**
 * A `tripwire.ts` default export, checked at the edge. Specs pass through by
 * reference: a step used twice must stay one step.
 */
export const workflowFileSchema = z.record(
	z.string(),
	z.object({
		kind: z.literal("workflow"),
		spec: z.custom<WorkflowSpec>((spec) => specShape.safeParse(spec).success, {
			error: "each entry must be workflow({ ... })",
		}),
	}),
	{ error: "the default export must be workflows({ ... })" },
);
export type WorkflowFile = z.infer<typeof workflowFileSchema>;

function isAuthoringAction(kind: string): kind is AuthoringActionKind {
	return Object.hasOwn(AUTHORING_ACTION_PARAMS, kind);
}

function isOutput(input: Input): input is Output {
	return input.kind === "output";
}

function isReview(step: Step): step is ReviewStep {
	return step.kind === "action" && step.action === "send-to-moderation";
}

function portWhen(port: OutputPort, source: Step): EdgeWhen | undefined {
	if (port === "pass") {
		return undefined;
	}
	return source.kind === "trigger" ? undefined : port;
}

function negate(port: OutputPort): OutputPort {
	switch (port) {
		case "pass":
			return "fail";
		case "fail":
			return "pass";
		case "approve":
			return "deny";
		default:
			return "approve";
	}
}

function baseId(step: Step): string {
	switch (step.kind) {
		case "trigger":
			return step.on.includes("schedule.matched") ? "schedule" : "trigger";
		case "check":
			return step.rule.split("@")[0] ?? "check";
		case "gate":
			return step.mode;
		default:
			return step.action;
	}
}

const ID_PATTERN = /^[^\p{Cc}]+$/u;

class WorkflowCompiler {
	readonly issues: CompileIssue[] = [];
	private readonly ids = new Map<Step, string>();
	private readonly taken = new Set<string>();
	private readonly nodes: WorkflowNode[] = [];
	private readonly edges: WorkflowEdge[] = [];
	private readonly edgeKeys = new Set<string>();
	private readonly built = new Set<Step>();
	private readonly triggers: Step[] = [];

	constructor(
		private readonly key: string,
		private readonly spec: WorkflowSpec,
	) {}

	private issue(message: string, step?: Step): void {
		const id = step ? this.ids.get(step) : undefined;
		this.issues.push({
			workflow: this.key,
			step: id,
			message,
		});
	}

	private idFor(step: Step): string {
		const known = this.ids.get(step);
		if (known) {
			return known;
		}
		const base = baseId(step);
		let id = base;
		for (let n = 2; this.taken.has(id); n++) {
			id = `${base}-${n}`;
		}
		this.ids.set(step, id);
		this.taken.add(id);
		return id;
	}

	private connect(source: Step, port: OutputPort, target: Step): void {
		if (source.kind === "trigger" && port !== "pass") {
			this.issue(
				"a trigger has only its event output; put a check or gate between it and this step",
				target,
			);
			return;
		}
		const from = this.visit(source);
		const to = this.idFor(target);
		const when = portWhen(port, source);
		const key = `${from}>${to}>${when ?? "pass"}`;
		if (this.edgeKeys.has(key)) {
			return;
		}
		this.edgeKeys.add(key);
		let id = `${from}-${to}`;
		for (let n = 2; this.edges.some((edge) => edge.id === id); n++) {
			id = `${from}-${to}-${n}`;
		}
		this.edges.push(when ? { id, from, to, when } : { id, from, to });
	}

	private wireInputs(step: Step, inputs: readonly Input[]): void {
		for (const input of inputs) {
			if (!inputShape.safeParse(input).success) {
				this.issue("an input is not a step or a step output", step);
				continue;
			}
			if (isOutput(input)) {
				if (!outputShape.safeParse(input).success) {
					this.issue("an input is not a step or a step output", step);
					continue;
				}
				this.connect(input.step, input.port, step);
			} else {
				this.connect(input, "pass", step);
			}
		}
	}

	private wireFromTriggers(step: Step): void {
		for (const source of this.triggers) {
			this.connect(source, "pass", step);
		}
	}

	visit(step: Step): string {
		if (!stepShape.safeParse(step).success) {
			this.issue("a step was not built with the workflow helpers");
			return "invalid";
		}
		const id = this.idFor(step);
		if (this.built.has(step)) {
			return id;
		}
		this.built.add(step);
		switch (step.kind) {
			case "trigger":
				this.buildTrigger(step, id);
				break;
			case "check":
				this.buildCheck(step, id);
				break;
			case "gate":
				this.buildGate(step, id);
				break;
			default:
				this.buildAction(step, id);
		}
		return id;
	}

	private buildTrigger(step: TriggerStep, id: string): void {
		const kinds: EventKind[] = [];
		for (const kind of step.on) {
			const parsed = eventKindSchema.safeParse(kind);
			if (
				parsed.success &&
				(parsed.data === "schedule.matched" ||
					AUTHORING_EVENT_KINDS.some((allowed) => allowed === parsed.data))
			) {
				kinds.push(parsed.data);
			} else {
				this.issue(
					unknownMessage(
						"an event a workflow can start on",
						kind,
						AUTHORING_EVENT_KINDS,
					),
					step,
				);
			}
		}
		if (kinds.length === 0) {
			if (step.on.length === 0) {
				this.issue("a trigger needs at least one event", step);
			}
			return;
		}
		if (step.schedule !== undefined) {
			const parsed = triggerScheduleSchema.safeParse(step.schedule);
			if (!parsed.success) {
				for (const problem of parsed.error.issues) {
					this.issue(
						`schedule: ${problem.path.length > 0 ? `${problem.path.join(".")}: ` : ""}${problem.message}`,
						step,
					);
				}
				return;
			}
			this.nodes.push({
				id,
				type: "trigger",
				kinds,
				schedule: triggerScheduleSchema.parse(step.schedule),
			});
			return;
		}
		this.nodes.push({ id, type: "trigger", kinds });
	}

	private buildCheck(step: CheckStep, id: string): void {
		const custom = step.rule.startsWith("custom-");
		let ref = step.rule;
		if (custom) {
			ref = step.rule.includes("@") ? step.rule : `${step.rule}@1`;
		} else {
			const entry = RULE_CATALOG.find((rule) => rule.ruleId === step.rule);
			if (!entry) {
				this.issue(
					unknownMessage(
						"a rule",
						step.rule,
						RULE_CATALOG.map((rule) => rule.ruleId),
					),
					step,
				);
				return;
			}
			const version = step.version ?? entry.version;
			ref = `${entry.ruleId}@${version}`;
			if (version === entry.version) {
				for (const message of settingsIssues(
					step.config,
					entry.configSchema,
					entry.ruleId,
				)) {
					this.issue(message, step);
				}
			}
		}
		const config = jsonValueSchema.safeParse(step.config ?? {});
		if (!config.success) {
			this.issue(`${step.rule} settings must be plain JSON`, step);
			return;
		}
		this.nodes.push({ id, type: "rule", ref, config: config.data });
		if (step.inputs.length === 0) {
			this.wireFromTriggers(step);
		} else {
			this.wireInputs(step, step.inputs);
		}
	}

	private buildGate(step: GateStep, id: string): void {
		if (step.inputs.length === 0) {
			this.issue(`${step.mode} needs at least one input`, step);
		}
		if (step.mode === "not" && step.inputs.length > 1) {
			this.issue("not takes exactly one input", step);
		}
		this.nodes.push({ id, type: "gate", mode: step.mode });
		this.wireInputs(step, step.inputs);
	}

	private buildAction(step: ActionStep | ReviewStep, id: string): void {
		const action = step.action;
		if (!isAuthoringAction(action)) {
			this.issue(
				unknownMessage(
					"an action",
					action,
					Object.keys(AUTHORING_ACTION_PARAMS),
				),
				step,
			);
			return;
		}
		const schema = AUTHORING_ACTION_PARAMS[action];
		for (const message of settingsIssues(step.params, schema, action)) {
			this.issue(message, step);
		}
		const params = objectSchema.safeParse(step.params ?? {});
		const json = z
			.record(z.string(), jsonValueSchema)
			.safeParse(params.success ? params.data : {});
		const node: WorkflowNode = { id, type: "action", action };
		if (json.success && Object.keys(json.data).length > 0) {
			node.params = json.data;
		}
		this.nodes.push(node);
		if (step.inputs.length > 0) {
			this.wireInputs(step, step.inputs);
		}
		if (isReview(step)) {
			for (const next of step.approve) {
				this.visit(next);
				this.connect(step, "approve", next);
			}
			for (const next of step.deny) {
				this.visit(next);
				this.connect(step, "deny", next);
			}
		}
	}

	private hasIncoming(step: Step): boolean {
		const id = this.ids.get(step);
		return this.edges.some((edge) => edge.to === id);
	}

	compile(): WorkflowDefinition | null {
		const spec = this.spec;
		for (const [name, step] of Object.entries(spec.steps ?? {})) {
			if (!ID_PATTERN.test(name)) {
				this.issue(`${name} is not a usable step id`);
				continue;
			}
			if (this.taken.has(name)) {
				this.issue(`two steps share the id ${name}`);
				continue;
			}
			this.ids.set(step, name);
			this.taken.add(name);
		}
		const on =
			spec.on === undefined ? [] : Array.isArray(spec.on) ? spec.on : [spec.on];
		const kinds: string[] = [];
		const steps: TriggerStep[] = [];
		for (const entry of on) {
			const kind = z.string().safeParse(entry);
			const step = triggerStepSchema.safeParse(entry);
			if (kind.success) {
				kinds.push(kind.data);
			} else if (step.success) {
				steps.push(step.data);
			}
		}
		if (kinds.length > 0) {
			this.triggers.push({ kind: "trigger", on: kinds, inputs: [] });
		}
		this.triggers.push(...steps);
		for (const step of Object.values(spec.steps ?? {})) {
			if (step.kind === "trigger" && !this.triggers.includes(step)) {
				this.triggers.push(step);
			}
		}
		if (this.triggers.length === 0) {
			this.issue("add `on`, the events or schedule that start it");
		}
		for (const source of this.triggers) {
			this.visit(source);
		}
		if (spec.check !== undefined) {
			const root = isOutput(spec.check)
				? { step: spec.check.step, port: spec.check.port }
				: { step: spec.check, port: "pass" as const };
			if (
				!isOutput(spec.check) &&
				(root.step.kind === "trigger" || root.step.kind === "action")
			) {
				this.issue(
					"`check` takes a check, a gate or one of their outputs; a trigger or action has no Passes and Doesn't pass",
				);
			}
			this.visit(root.step);
			for (const next of spec.pass ?? []) {
				this.visit(next);
				this.connect(root.step, root.port, next);
			}
			for (const next of spec.fail ?? []) {
				this.visit(next);
				this.connect(root.step, negate(root.port), next);
			}
		} else if ((spec.pass ?? []).length > 0 || (spec.fail ?? []).length > 0) {
			this.issue(
				"`pass` and `fail` need a `check`; use `run` for actions with no check",
			);
		}
		for (const next of spec.run ?? []) {
			this.visit(next);
			for (const source of this.triggers) {
				this.connect(source, "pass", next);
			}
		}
		const named = Object.values(spec.steps ?? {});
		for (const step of named) {
			this.visit(step);
		}
		for (const step of named) {
			if (step.kind === "action" && !this.hasIncoming(step)) {
				this.wireFromTriggers(step);
			}
		}
		if (this.issues.length > 0) {
			return null;
		}
		const parsed = workflowDefinitionSchema.safeParse({
			id: this.key,
			name: spec.name ?? this.key,
			version: 1,
			nodes: this.nodes,
			edges: this.edges,
		});
		if (!parsed.success) {
			for (const problem of parsed.error.issues) {
				this.issue(problem.message);
			}
			return null;
		}
		return parsed.data;
	}
}

/**
 * Compiles a `tripwire.ts` default export to stored definitions. Errors come
 * back as values, with a suggestion for every id that is close to a real one.
 */
export function compileWorkflows(file: WorkflowFile): CompileResult {
	const issues: CompileIssue[] = [];
	const definitions: WorkflowDefinition[] = [];
	for (const [key, value] of Object.entries(file)) {
		const compiler = new WorkflowCompiler(key, value.spec);
		const definition = compiler.compile();
		issues.push(...compiler.issues);
		if (definition) {
			definitions.push(definition);
		}
	}
	return issues.length > 0 ? { ok: false, issues } : { ok: true, definitions };
}

/** Parses a loaded default export, then compiles it. */
export function compileWorkflowModule(loaded: {
	default?: WorkflowFile | SettingValue;
}): CompileResult {
	const file = workflowFileSchema.safeParse(loaded.default);
	if (!file.success) {
		return {
			ok: false,
			issues: file.error.issues.map((issue) => ({
				workflow: String(issue.path[0] ?? ""),
				message: issue.message,
			})),
		};
	}
	return compileWorkflows(file.data);
}

export interface ScheduleReadBack {
	nodeId: string;
	summary: string;
	timezone: string;
	defaulted: boolean;
}

export interface WorkflowReport {
	id: string;
	name: string;
	/** True when nothing stops it from being turned on. */
	valid: boolean;
	issues: LintResult[];
	schedules: ScheduleReadBack[];
}

export type WorkflowCheck =
	| { ok: true; workflows: WorkflowReport[] }
	| { ok: false; issues: CompileIssue[] };

/** How each schedule in a definition reads back, zone included. */
export function scheduleReadBacks(
	definition: WorkflowDefinition,
): ScheduleReadBack[] {
	return definition.nodes.flatMap((node) => {
		if (node.type !== "trigger" || !node.schedule?.every) {
			return [];
		}
		const zone = scheduleZone(node.schedule.timezone);
		return [
			{
				nodeId: node.id,
				summary: describeSchedule({
					every: node.schedule.every,
					timezone: node.schedule.timezone,
				}),
				timezone: zone.zone,
				defaulted: zone.defaulted,
			},
		];
	});
}

/** Lints stored definitions the way turning them on would. */
export function reportWorkflows(
	definitions: readonly WorkflowDefinition[],
	catalog?: readonly ValidationCatalogEntry[],
): WorkflowReport[] {
	return definitions.map((definition) => {
		const issues = lintWorkflow(definition, catalog ? { catalog } : {});
		return {
			id: definition.id,
			name: definition.name,
			valid: !issues.some((issue) => issue.severity === "error"),
			issues,
			schedules: scheduleReadBacks(definition),
		};
	});
}

/** Compiles a `tripwire.ts` default export, then lints every workflow in it. */
export function checkWorkflows(
	file: WorkflowFile,
	catalog?: readonly ValidationCatalogEntry[],
): WorkflowCheck {
	const compiled = compileWorkflows(file);
	if (!compiled.ok) {
		return compiled;
	}
	return {
		ok: true,
		workflows: reportWorkflows(compiled.definitions, catalog),
	};
}
