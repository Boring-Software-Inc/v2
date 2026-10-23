import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AUTHORING_MODULE_PATH,
	authoringModuleText,
	type CompileResult,
	compileWorkflowModule,
	RULE_CATALOG,
	type ValidationCatalogEntry,
	WORKFLOW_STATE_LABELS,
	type WorkflowDefinition,
	type WorkflowState,
	workflowDefinitionSchema,
	workflowsToCode,
} from "@tripwire/contracts";
import { z } from "zod";
import { authoringSource } from "#/authoring-source" with { type: "macro" };
import { pairs, type Style } from "#/format";
import type { PickerItem } from "#/picker";

export const DEFAULT_WORKFLOW_FILE = "tripwire.ts";

const nodeFeaturesSchema = z.object({
	typescript: z.union([z.string(), z.boolean()]).optional(),
});

/** Whether this runtime can import a `.ts` file by itself. */
export function canLoadTypeScript(): boolean {
	if (process.versions.bun) {
		return true;
	}
	const features = nodeFeaturesSchema.safeParse(process.features);
	return features.success && Boolean(features.data.typescript);
}

/** Writes the project's copy of the authoring module next to the file. */
export function writeAuthoringModule(file: string): string {
	const target = join(dirname(resolve(file)), AUTHORING_MODULE_PATH);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, authoringModuleText(authoringSource()));
	return target;
}

/** Loads a `tripwire.ts` and compiles its default export. */
export async function loadWorkflowFile(file: string): Promise<CompileResult> {
	const path = resolve(file);
	if (!existsSync(path)) {
		throw new Error(
			`No ${file} here. Run tripwire workflows pull <repo> to start one.`,
		);
	}
	if (!canLoadTypeScript()) {
		throw new Error(
			"Loading tripwire.ts needs Node 22.18 or later, or Bun. Run it with bunx @tripwire-sh/cli instead.",
		);
	}
	const moduleText = join(dirname(path), AUTHORING_MODULE_PATH);
	if (!existsSync(moduleText)) {
		writeAuthoringModule(path);
	}
	const url = `${pathToFileURL(path).href}?at=${Date.now()}`;
	return compileWorkflowModule(await import(url));
}

const pulledSchema = z.object({
	workflows: z.array(
		z.object({
			id: z.string(),
			appId: z.string().optional(),
			name: z.string().optional(),
			enabled: z.boolean().optional(),
			definition: workflowDefinitionSchema,
		}),
	),
});

type JsonValue = z.infer<ReturnType<typeof z.json>>;

export interface PulledWorkflow {
	id: string;
	appId?: string;
	name: string;
	enabled: boolean;
	definition: WorkflowDefinition;
}

export function pulledWorkflows(data: JsonValue | null): PulledWorkflow[] {
	return pulledSchema.parse(data).workflows.map((entry) => ({
		id: entry.id,
		appId: entry.appId,
		name: entry.name ?? entry.definition.name,
		enabled: entry.enabled ?? false,
		definition: entry.definition,
	}));
}

function triggerKinds(definition: WorkflowDefinition): string[] {
	return [
		...new Set(
			definition.nodes.flatMap((node) =>
				node.type === "trigger" ? node.kinds : [],
			),
		),
	];
}

function codeProblem(definition: WorkflowDefinition): string | undefined {
	const result = workflowsToCode([definition], {
		importFrom: AUTHORING_MODULE_PATH,
	});
	if (result.written.length > 0) {
		return undefined;
	}
	const warning = result.warnings[0] ?? "";
	const reason = warning.slice(warning.indexOf("cannot be written as code"));
	return reason.startsWith("cannot") ? reason : "cannot be written as code";
}

export function workflowChoices(
	workflows: readonly PulledWorkflow[],
	states: ReadonlyMap<string, WorkflowState>,
): PickerItem[] {
	return workflows.map((workflow) => {
		const problem = codeProblem(workflow.definition);
		if (problem) {
			return { value: workflow.id, label: workflow.name, disabled: problem };
		}
		const state =
			(workflow.appId ? states.get(workflow.appId) : undefined) ??
			(workflow.enabled ? "on" : "off");
		const kinds = triggerKinds(workflow.definition);
		const triggers =
			kinds.length > 2
				? `${kinds.slice(0, 2).join(", ")} +${kinds.length - 2} more`
				: kinds.join(", ");
		const hint = [WORKFLOW_STATE_LABELS[state].toLowerCase(), triggers]
			.filter(Boolean)
			.join(", ");
		return { value: workflow.id, label: workflow.name, hint };
	});
}

export function initialPicks(
	choices: readonly PickerItem[],
	localIds: readonly string[] | null,
): string[] {
	return choices
		.filter((choice) => choice.disabled === undefined)
		.filter((choice) => localIds === null || localIds.includes(choice.value))
		.map((choice) => choice.value);
}

export interface PullSelection {
	picked: PulledWorkflow[];
	unknown: string[];
}

export function selectPulled(
	workflows: readonly PulledWorkflow[],
	wanted: readonly string[],
): PullSelection {
	const hits = (workflow: PulledWorkflow, key: string) =>
		workflow.id === key || workflow.appId === key || workflow.name === key;
	return {
		picked: workflows.filter((workflow) =>
			wanted.some((key) => hits(workflow, key)),
		),
		unknown: wanted.filter(
			(key) => !workflows.some((workflow) => hits(workflow, key)),
		),
	};
}

export interface MergedDefinitions {
	definitions: WorkflowDefinition[];
	kept: string[];
}

export function mergeDefinitions(
	local: readonly WorkflowDefinition[],
	pulled: readonly WorkflowDefinition[],
): MergedDefinitions {
	const byId = new Map(pulled.map((definition) => [definition.id, definition]));
	const definitions = local.map(
		(definition) => byId.get(definition.id) ?? definition,
	);
	const known = new Set(local.map((definition) => definition.id));
	return {
		definitions: [
			...definitions,
			...pulled.filter((definition) => !known.has(definition.id)),
		],
		kept: local
			.filter((definition) => !byId.has(definition.id))
			.map((definition) => definition.name),
	};
}

const customConfigSchema = z.record(z.string(), z.json());

/**
 * The catalog for a check without a repo: the built-in rules, plus every
 * custom rule the file names, taken on trust until `--repo` checks it.
 */
export function localCatalog(
	definitions: readonly WorkflowDefinition[],
): ValidationCatalogEntry[] {
	const custom = new Set(
		definitions.flatMap((definition) =>
			definition.nodes.flatMap((node) =>
				node.type === "rule" && node.ref.startsWith("custom-")
					? [node.ref]
					: [],
			),
		),
	);
	return [
		...RULE_CATALOG,
		...[...custom].map((ref) => {
			const [ruleId = ref, version = "1"] = ref.split("@");
			return {
				ruleId,
				version: Number(version),
				name: ruleId,
				configSchema: customConfigSchema,
			};
		}),
	];
}

export interface PullWrite {
	file: string;
	module: string;
	count: number;
	pulled: number;
	kept: string[];
	warnings: string[];
}

function workflowCount(count: number): string {
	return `${count} ${count === 1 ? "workflow" : "workflows"}`;
}

export function pulledCountText(
	write: Pick<PullWrite, "count" | "pulled">,
): string {
	const left = write.pulled - write.count;
	return left > 0
		? `${workflowCount(write.count)}, ${left} left out`
		: workflowCount(write.count);
}

export type LocalWorkflows =
	| { kind: "none" }
	| { kind: "code"; text: string; definitions: WorkflowDefinition[] }
	| { kind: "unreadable" };

export async function readLocalWorkflows(
	file: string,
): Promise<LocalWorkflows> {
	const path = resolve(file);
	if (!existsSync(path)) {
		return { kind: "none" };
	}
	try {
		const compiled = await loadWorkflowFile(file);
		return compiled.ok
			? {
					kind: "code",
					text: readFileSync(path, "utf8"),
					definitions: compiled.definitions,
				}
			: { kind: "unreadable" };
	} catch {
		return { kind: "unreadable" };
	}
}

function codeOf(definitions: readonly WorkflowDefinition[]): string {
	return workflowsToCode(definitions, { importFrom: AUTHORING_MODULE_PATH })
		.code;
}

function listText(names: readonly string[]): string {
	return names.length <= 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function refusal(
	file: string,
	local: LocalWorkflows,
	definitions: readonly WorkflowDefinition[],
): string | null {
	if (local.kind === "unreadable") {
		return `${file} does not compile, so a pull cannot keep its other workflows. Fix it, or pass --force to replace it.`;
	}
	if (local.kind !== "code") {
		return null;
	}
	const differs = definitions
		.filter((definition) => {
			const mine = local.definitions.find((item) => item.id === definition.id);
			return mine !== undefined && codeOf([mine]) !== codeOf([definition]);
		})
		.map((definition) => definition.name);
	const name = basename(file);
	if (differs.length > 0) {
		return `${listText(differs)} in ${name} ${differs.length === 1 ? "differs" : "differ"} from the server. Run tripwire workflows diff <repo> to compare, or pass --force to take the server's version.`;
	}
	if (codeOf(local.definitions) !== local.text) {
		return `${name} has edits a pull would rewrite. Pass --force to rewrite it, or diff it first.`;
	}
	return null;
}

/** Writes pulled definitions as code, refusing to clobber local edits. */
export function writePulled(
	file: string,
	definitions: readonly WorkflowDefinition[],
	force: boolean,
	local: LocalWorkflows = { kind: "none" },
): PullWrite {
	const path = resolve(file);
	const merged = mergeDefinitions(
		local.kind === "code" ? local.definitions : [],
		definitions,
	);
	const { code, warnings, written } = workflowsToCode(merged.definitions, {
		importFrom: AUTHORING_MODULE_PATH,
	});
	const unchanged = local.kind === "code" && local.text === code;
	const problem = force || unchanged ? null : refusal(file, local, definitions);
	if (problem) {
		throw new Error(problem);
	}
	const module = writeAuthoringModule(path);
	writeFileSync(path, code);
	const pulledIds = new Set(definitions.map((definition) => definition.id));
	return {
		file: path,
		module,
		count: written.filter((id) => pulledIds.has(id)).length,
		pulled: definitions.length,
		kept: merged.kept,
		warnings,
	};
}

/** What the CLI prints of a workflow report, local or from the server. */
export interface ReportView {
	id: string;
	valid: boolean;
	issues: readonly { severity: string; step: string; message: string }[];
	schedules: readonly {
		nodeId: string;
		summary: string;
		description?: string;
	}[];
}

/** Plain-text read-back of reports: one block per workflow. */
export function formatReports(
	reports: readonly ReportView[],
	style: Style,
): string {
	return reports
		.map((report) => {
			const rows: [string, string][] = [
				[
					report.valid ? "ok" : "error",
					report.valid
						? style.good(`${report.id} can be turned on`)
						: style.bad(`${report.id} cannot be turned on yet`),
				],
			];
			for (const issue of report.issues) {
				rows.push([
					issue.severity === "error" ? "fix" : "warn",
					`${issue.step}: ${issue.message}`,
				]);
			}
			for (const schedule of report.schedules) {
				rows.push([
					"runs",
					`${schedule.nodeId}: ${schedule.description ?? schedule.summary}`,
				]);
			}
			return pairs(rows, style);
		})
		.join("\n\n");
}
