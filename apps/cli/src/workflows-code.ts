import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AUTHORING_MODULE_PATH,
	authoringModuleText,
	type CompileResult,
	compileWorkflowModule,
	RULE_CATALOG,
	type ValidationCatalogEntry,
	type WorkflowDefinition,
	workflowDefinitionSchema,
	workflowsToCode,
} from "@tripwire/contracts";
import { z } from "zod";
import { authoringSource } from "#/authoring-source" with { type: "macro" };
import { pairs, type Style } from "#/format";

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
	workflows: z.array(z.object({ definition: workflowDefinitionSchema })),
});

type JsonValue = z.infer<ReturnType<typeof z.json>>;

/** The stored definitions in a get_workflow reply. */
export function pulledDefinitions(
	data: JsonValue | null,
): WorkflowDefinition[] {
	return pulledSchema.parse(data).workflows.map((entry) => entry.definition);
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
	warnings: string[];
}

/** Writes pulled definitions as code, refusing to clobber local edits. */
export function writePulled(
	file: string,
	definitions: readonly WorkflowDefinition[],
	force: boolean,
): PullWrite {
	const path = resolve(file);
	const { code, warnings } = workflowsToCode(definitions, {
		importFrom: AUTHORING_MODULE_PATH,
	});
	if (existsSync(path) && !force && readFileSync(path, "utf8") !== code) {
		throw new Error(
			`${file} already exists. Pass --force to replace it, or diff it first.`,
		);
	}
	const module = writeAuthoringModule(path);
	writeFileSync(path, code);
	return { file: path, module, count: definitions.length, warnings };
}

/** What the CLI prints of a workflow report, local or from the server. */
export interface ReportView {
	id: string;
	valid: boolean;
	issues: readonly { severity: string; step: string; message: string }[];
	schedules: readonly { nodeId: string; summary: string }[];
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
				rows.push(["runs", `${schedule.nodeId}: ${schedule.summary}`]);
			}
			return pairs(rows, style);
		})
		.join("\n\n");
}
