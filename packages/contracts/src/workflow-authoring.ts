/**
 * The `tripwire.ts` authoring API. A workflow file default-exports
 * `workflows({ ... })`; each entry compiles to one stored WorkflowDefinition.
 *
 * This file imports nothing, so the CLI can copy it into a project verbatim,
 * append the catalog types, and Node can load a `tripwire.ts` that uses it
 * with type stripping alone. `authoring<Catalog>()` binds the helpers to a
 * catalog: `workflow-authoring-catalog.ts` inside this repo, generated text
 * in a project's copy.
 */

/** A value a rule setting or action param can hold: plain JSON. */
export type SettingValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly SettingValue[]
	| Settings;

/** Rule settings or action params, as written in code. */
export interface Settings {
	readonly [key: string]: SettingValue;
}

/** One settings shape per rule id or action kind. */
export interface SettingsByName {
	readonly [name: string]: Settings;
}

export interface AuthoringCatalog {
	/** Rule id to the config it takes. */
	readonly rules: SettingsByName;
	/** Action kind to the params it takes. */
	readonly actions: SettingsByName;
	/** Event kinds a workflow can start on. */
	readonly events: string;
	/** Settings for a schedule trigger. */
	readonly schedule: unknown;
}

export type CustomRuleRef = `custom-${string}`;

export type OutputPort = "pass" | "fail" | "approve" | "deny";

export interface Output {
	readonly kind: "output";
	readonly step: Step;
	readonly port: OutputPort;
}

export type Input = Step | Output;

interface StepBase {
	readonly inputs: readonly Input[];
}

export interface TriggerStep extends StepBase {
	readonly kind: "trigger";
	readonly on: readonly string[];
	readonly schedule?: unknown;
}

export interface ResultOutputs {
	/** The step's Passes output. */
	readonly passes: Output;
	/** The step's Doesn't pass output: `not(passes)`, accepted wherever Passes is. */
	readonly fails: Output;
}

export interface CheckStep extends StepBase, ResultOutputs {
	readonly kind: "check";
	readonly rule: string;
	readonly config: Settings;
	readonly version: number | undefined;
	/** Runs this check after the given outputs instead of the triggers. */
	after(...inputs: Input[]): CheckStep;
}

export type AuthoringGateMode = "all-of" | "any-of" | "not";

export interface GateStep extends StepBase, ResultOutputs {
	readonly kind: "gate";
	readonly mode: AuthoringGateMode;
}

export interface ActionStep extends StepBase {
	readonly kind: "action";
	readonly action: string;
	readonly params: Settings | undefined;
	/** Runs this action after the given outputs. */
	after(...inputs: Input[]): ActionStep;
}

export interface ReviewStep extends StepBase {
	readonly kind: "action";
	readonly action: "send-to-moderation";
	readonly params: undefined;
	readonly approve: readonly ActionStep[];
	readonly deny: readonly ActionStep[];
	/** The maintainer approved it. */
	readonly approved: Output;
	/** The maintainer blocked it. */
	readonly denied: Output;
	after(...inputs: Input[]): ReviewStep;
}

export type Step = TriggerStep | CheckStep | GateStep | ActionStep | ReviewStep;

export interface WorkflowSpec<Event extends string = string> {
	/** The name shown in the app. Defaults to the workflow's key. */
	readonly name?: string;
	/** What starts it: event kinds, or `trigger()` / `schedule()` steps. */
	readonly on?: Event | TriggerStep | readonly (Event | TriggerStep)[];
	/** The condition. A check, a gate, or one output of either. */
	readonly check?: Input;
	/** Actions when `check` passes. */
	readonly pass?: readonly (ActionStep | ReviewStep)[];
	/** Actions when `check` does not pass. */
	readonly fail?: readonly (ActionStep | ReviewStep)[];
	/** Actions straight after the triggers, for workflows with no check. */
	readonly run?: readonly (ActionStep | ReviewStep)[];
	/** Named steps. The key becomes the step id; use it for any other wiring. */
	readonly steps?: Readonly<Record<string, Step>>;
}

export interface WorkflowValue {
	readonly kind: "workflow";
	readonly spec: WorkflowSpec;
}

type Head<S extends string> = S extends `${infer A}${infer B}${string}`
	? `${A}${B}`
	: S;

/** Ids that start like the one given, or every id when none do. */
type Suggest<Given extends string, Valid extends string> = [
	Extract<Valid, `${Head<Given>}${string}`>,
] extends [never]
	? Valid
	: Extract<Valid, `${Head<Given>}${string}`>;

/**
 * The shape, plus a type error for every key it does not have that names the
 * keys it does.
 */
export type Checked<Shape, Given> = Shape & {
	[Key in keyof Given]: Key extends keyof Shape
		? Shape[Key]
		: `${Key & string} is not a setting here, try ${keyof Shape & string}`;
};

export interface CheckOptions {
	/** Pin an older rule version. Defaults to the current one. */
	readonly version?: number;
}

type RuleName<C extends AuthoringCatalog> = keyof C["rules"] & string;

type RuleArg<C extends AuthoringCatalog, R extends string> =
	R extends RuleName<C>
		? R
		: `${R} is not a rule, try ${Suggest<R, RuleName<C>>}`;

type ConfigOf<C extends AuthoringCatalog, R> = R extends keyof C["rules"]
	? C["rules"][R]
	: never;

type CheckArgs<C extends AuthoringCatalog, R extends string, Given> =
	R extends RuleName<C>
		? Record<never, never> extends ConfigOf<C, R>
			? [config?: Checked<ConfigOf<C, R>, Given>, options?: CheckOptions]
			: [config: Checked<ConfigOf<C, R>, Given>, options?: CheckOptions]
		: [config?: undefined, options?: undefined];

type ParamsOf<
	C extends AuthoringCatalog,
	A extends string,
> = A extends keyof C["actions"] ? C["actions"][A] : never;

function output(step: Step, port: OutputPort): Output {
	return { kind: "output", step, port };
}

function makeCheck(
	rule: string,
	config: Settings | undefined,
	options: CheckOptions | undefined,
	inputs: readonly Input[],
): CheckStep {
	const step: CheckStep = {
		kind: "check",
		rule,
		config: config ?? {},
		version: options?.version,
		inputs,
		get passes() {
			return output(step, "pass");
		},
		get fails() {
			return output(step, "fail");
		},
		after: (...next: Input[]) => makeCheck(rule, config, options, next),
	};
	return step;
}

function gate(mode: AuthoringGateMode, inputs: readonly Input[]): GateStep {
	const step: GateStep = {
		kind: "gate",
		mode,
		inputs,
		get passes() {
			return output(step, "pass");
		},
		get fails() {
			return output(step, "fail");
		},
	};
	return step;
}

function action(
	kind: string,
	params: Settings | undefined,
	inputs: readonly Input[] = [],
): ActionStep {
	return {
		kind: "action",
		action: kind,
		params,
		inputs,
		after: (...next: Input[]) => action(kind, params, next),
	};
}

function review(
	branches: { approve?: readonly ActionStep[]; deny?: readonly ActionStep[] },
	inputs: readonly Input[],
): ReviewStep {
	const step: ReviewStep = {
		kind: "action",
		action: "send-to-moderation",
		params: undefined,
		approve: branches.approve ?? [],
		deny: branches.deny ?? [],
		inputs,
		get approved() {
			return output(step, "approve");
		},
		get denied() {
			return output(step, "deny");
		},
		after: (...next: Input[]) => review(branches, next),
	};
	return step;
}

/** The authoring helpers, typed from a catalog. */
export function authoring<C extends AuthoringCatalog>() {
	type Event = C["events"];

	return {
		/**
		 * A built-in rule check, typed from the catalog:
		 * `check("account-age", { minDays: 7 })`. A wrong rule id or setting
		 * fails type-checking with the ids or settings to use instead.
		 */
		check<const R extends string, G = ConfigOf<C, R>>(
			rule: RuleArg<C, R>,
			...args: CheckArgs<C, R, G>
		): CheckStep {
			const [config, options] = args;
			return makeCheck(rule, config, options, []);
		},

		/** One of the repo's custom rules, by its `custom-...` id. */
		customCheck(rule: CustomRuleRef, config?: Settings): CheckStep {
			return makeCheck(rule, config, undefined, []);
		},

		/** Passes when every input passes. */
		allOf(...inputs: Input[]): GateStep {
			return gate("all-of", inputs);
		},

		/** Passes when at least one input passes. */
		anyOf(...inputs: Input[]): GateStep {
			return gate("any-of", inputs);
		},

		/** An explicit Not gate. `step.fails` says the same without a gate. */
		not(input: Input): GateStep {
			return gate("not", [input]);
		},

		/** Starts on events: `trigger("change-request.opened", "comment.created")`. */
		trigger(...on: Event[]): TriggerStep {
			return { kind: "trigger", on, inputs: [] };
		},

		/** Starts on a timer for matching issues and change requests. */
		schedule(spec: C["schedule"]): TriggerStep {
			return {
				kind: "trigger",
				on: ["schedule.matched"],
				schedule: spec,
				inputs: [],
			};
		},

		/** Fails the Tripwire check and requests changes. */
		block(): ActionStep {
			return action("block", undefined);
		},

		/** Adds labels. */
		label<P = ParamsOf<C, "label">>(
			params: Checked<ParamsOf<C, "label">, P>,
		): ActionStep {
			return action("label", params);
		},

		/** Removes labels, if they are there. */
		removeLabel<P = ParamsOf<C, "remove-label">>(
			params: Checked<ParamsOf<C, "remove-label">, P>,
		): ActionStep {
			return action("remove-label", params);
		},

		/** Asks people or teams to review on GitHub. */
		requestReview<P = ParamsOf<C, "request-review">>(
			params: Checked<ParamsOf<C, "request-review">, P>,
		): ActionStep {
			return action("request-review", params);
		},

		/** Posts a comment you write. */
		postComment<P = ParamsOf<C, "post-comment">>(
			params: Checked<ParamsOf<C, "post-comment">, P>,
		): ActionStep {
			return action("post-comment", params);
		},

		/** Locks the conversation. */
		lock<P = ParamsOf<C, "lock">>(
			params?: Checked<ParamsOf<C, "lock">, P>,
		): ActionStep {
			return action("lock", params);
		},

		/** Closes the issue or change request. */
		close(): ActionStep {
			return action("close", undefined);
		},

		/** Posts the verdict as JSON. The URL is set in the app and never pulled. */
		webhook<P = ParamsOf<C, "webhook">>(
			params?: Checked<ParamsOf<C, "webhook">, P>,
		): ActionStep {
			return action("webhook", params);
		},

		/** Posts the verdict to Discord. The URL is set in the app and never pulled. */
		discord<P = ParamsOf<C, "discord">>(
			params?: Checked<ParamsOf<C, "discord">, P>,
		): ActionStep {
			return action("discord", params);
		},

		/**
		 * Waits for a maintainer in Tripwire. `approve` and `deny` run when they
		 * decide; `approved` and `denied` wire the decision anywhere else.
		 */
		humanReview(
			branches: {
				approve?: readonly ActionStep[];
				deny?: readonly ActionStep[];
			} = {},
		): ReviewStep {
			return review(branches, []);
		},

		workflow(spec: WorkflowSpec<Event>): WorkflowValue {
			return { kind: "workflow", spec };
		},

		/** The default export of a `tripwire.ts`. Keys are the workflow ids. */
		workflows<const T extends Record<string, WorkflowValue>>(entries: T): T {
			return entries;
		},
	};
}
