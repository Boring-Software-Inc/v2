import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AUTHORING_MODULE_PATH,
	authoringModuleText,
	type CompileResult,
	compileWorkflowModule,
	type WorkflowValue as LegacyWorkflowValue,
	RULE_CATALOG,
	type SettingValue,
	stripWorkflowSecrets,
	type ValidationCatalogEntry,
	WORKFLOW_STATE_LABELS,
	type WorkflowDefinition,
	type WorkflowState,
	workflowDefinitionSchema,
	workflowKeys,
	workflowsToCode,
	workflowToCode,
} from "@tripwire/contracts";
import { z } from "zod";
import { authoringSource } from "#/authoring-source" with { type: "macro" };
import { pairs, type Style, workflowTriggerWords } from "#/format";
import type { PickerItem } from "#/picker";
import type { System } from "#/system";

export const DEFAULT_WORKFLOW_FILE = "tripwire.ts";
export const DEFAULT_WORKFLOW_DIRECTORY = join(".tripwire", "workflows");

const WORKFLOW_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export function validateWorkflowSlug(slug: string): string {
	if (
		slug.length > 48 ||
		!WORKFLOW_SLUG.test(slug) ||
		WINDOWS_RESERVED_NAME.test(slug)
	) {
		throw new Error(
			`Invalid workflow slug ${slug}. Use up to 48 lowercase letters, numbers, and single hyphens; Windows device names are reserved.`,
		);
	}
	return slug;
}

export interface WorkflowSourceFile {
	slug: string;
	file: string;
}

export function discoverWorkflowFiles(directory: string): WorkflowSourceFile[] {
	const root = resolve(directory);
	if (!existsSync(root)) {
		return [];
	}
	const rootStat = lstatSync(root);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		throw new Error(
			`${directory} must be a real directory, not a file or symlink.`,
		);
	}
	const found: WorkflowSourceFile[] = [];
	const folded = new Set<string>();
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.name.endsWith(".ts")) {
			continue;
		}
		if (entry.isSymbolicLink() || !entry.isFile()) {
			throw new Error(
				`${join(directory, entry.name)} must be a real file, not a symlink.`,
			);
		}
		const slug = validateWorkflowSlug(entry.name.slice(0, -3));
		const key = slug.toLocaleLowerCase("en-US");
		if (folded.has(key)) {
			throw new Error(`${directory} contains more than one file for ${slug}.`);
		}
		folded.add(key);
		found.push({ slug, file: join(root, entry.name) });
	}
	return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function selectWorkflowSources(
	sources: readonly WorkflowSourceFile[],
	wanted: readonly string[],
): WorkflowSourceFile[] {
	for (const slug of wanted) {
		validateWorkflowSlug(slug);
	}
	const available = new Map(sources.map((source) => [source.slug, source]));
	const unknown = wanted.filter((slug) => !available.has(slug));
	if (unknown.length > 0) {
		throw new Error(
			`No local workflow ${unknown.join(", ")}. Available workflows: ${sources.map(({ slug }) => slug).join(", ") || "none"}.`,
		);
	}
	return wanted.length === 0
		? [...sources]
		: [...new Set(wanted)].map(
				(slug) => available.get(slug) as WorkflowSourceFile,
			);
}

function hasProtoKey(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(hasProtoKey);
	}
	if (typeof value !== "object" || value === null) {
		return false;
	}
	return Object.keys(value).some(
		(key) => key === "__proto__" || hasProtoKey(Reflect.get(value, key)),
	);
}

export function sdkWorkflowSource(definition: WorkflowDefinition): string {
	const safe = stripWorkflowSecrets(definition);
	if (hasProtoKey(safe)) {
		throw new Error(
			`Workflow ${definition.id} contains a __proto__ key that cannot be represented safely as TypeScript source.`,
		);
	}
	return (
		sdkHelperSource(safe) ??
		`import { defineWorkflow } from "@tripwire-sh/sdk/workflows";\n\nexport default defineWorkflow(${JSON.stringify(safe, null, "\t")});\n`
	);
}

function sdkHelperSource(definition: WorkflowDefinition): string | undefined {
	const [trigger, rule, action] = definition.nodes;
	if (
		trigger?.type !== "trigger" ||
		trigger.schedule ||
		definition.name.trim() !== definition.name ||
		!definition.name
	)
		return;
	const events = trigger.kinds.map((kind) => {
		switch (kind) {
			case "change-request.opened":
				return "changeRequest.opened";
			case "change-request.updated":
				return "changeRequest.updated";
			case "change-request.closed":
				return "changeRequest.closed";
			case "comment.created":
				return "comment.created";
			case "push":
				return "repository.pushed";
			default:
				return undefined;
		}
	});
	if (events.length === 0 || events.some((event) => event === undefined))
		return;
	const imports = new Set(events.map((event) => event?.split(".")[0] ?? ""));
	const spec = [
		`name: ${JSON.stringify(definition.name)}`,
		`when: ${events.length === 1 ? events[0] : `[${events.join(", ")}]`}`,
	];
	const nodes: Record<
		string,
		{ id: string; position?: { x: number; y: number } }
	> = {
		trigger: {
			id: trigger.id,
			...(trigger.position ? { position: trigger.position } : {}),
		},
	};
	const edges: Record<string, { id: string; explicitPass?: boolean }> = {};
	if (definition.nodes.length === 2 && rule?.type === "action") {
		const [edge] = definition.edges;
		const helper = {
			block: "block",
			close: "closeConversation",
			lock: "lockConversation",
			note: "note",
			webhook: "webhook",
			discord: "discord",
		};
		const name = Object.entries(helper).find(
			([kind]) => kind === rule.action,
		)?.[1];
		if (
			!name ||
			rule.params !== undefined ||
			definition.edges.length !== 1 ||
			edge?.from !== trigger.id ||
			edge.to !== rule.id ||
			(edge.when ?? "pass") !== "pass" ||
			edge.input
		)
			return;
		imports.add(name);
		spec.push(`run: ${name}()`);
		nodes[rule.action] = {
			id: rule.id,
			...(rule.position ? { position: rule.position } : {}),
		};
		edges[`trigger-pass-${rule.action}`] = {
			id: edge.id,
			...(edge.when ? { explicitPass: true } : {}),
		};
	} else if (definition.nodes.length !== 1 || definition.edges.length !== 0) {
		const [check, failure] = definition.edges;
		const config = z
			.strictObject({ minDays: z.number().int().min(0) })
			.safeParse(rule?.type === "rule" ? rule.config : null);
		if (
			definition.nodes.length !== 3 ||
			definition.edges.length !== 2 ||
			rule?.type !== "rule" ||
			rule.ref !== "account-age@1" ||
			!config.success ||
			action?.type !== "action" ||
			action.action !== "block" ||
			action.params !== undefined ||
			check?.from !== trigger.id ||
			check.to !== rule.id ||
			(check.when ?? "pass") !== "pass" ||
			check.input ||
			failure?.from !== rule.id ||
			failure.to !== action.id ||
			failure.when !== "fail" ||
			failure.input
		)
			return;
		imports.add("accountAge");
		imports.add("block");
		spec.push(
			`require: accountAge({ minDays: ${config.data.minDays} })`,
			"otherwise: block()",
		);
		nodes["account-age"] = {
			id: rule.id,
			...(rule.position ? { position: rule.position } : {}),
		};
		nodes.block = {
			id: action.id,
			...(action.position ? { position: action.position } : {}),
		};
		edges["trigger-pass-account-age"] = {
			id: check.id,
			...(check.when ? { explicitPass: true } : {}),
		};
		edges["account-age-fail-block"] = { id: failure.id };
	}
	imports.add("workflow");
	imports.add("workflowIdentityVersion");
	const identity = {
		version: definition.version,
		nodes,
		...(Object.keys(edges).length ? { edges } : {}),
	};
	return `import { ${[...imports].sort().join(", ")} } from "@tripwire-sh/sdk/workflows";\n\nexport default workflow({\n\t${spec.join(",\n\t")},\n}, {\n\tformat: workflowIdentityVersion,${JSON.stringify(identity, null, "\t").slice(1)});\n`;
}

export interface SdkPullWrite {
	files: string[];
	unchanged: string[];
	hashes: Record<string, string>;
}

function workflowSourceHash(source: string): string {
	return createHash("sha256")
		.update(source.replaceAll("\r\n", "\n"))
		.digest("hex");
}

function assertNoSymlinkInPath(path: string): void {
	const root = resolve(path);
	for (const current of [root, dirname(root)]) {
		if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
			throw new Error(
				`${current} is a symlink; workflow paths must be real directories.`,
			);
		}
	}
}

export function writeSdkWorkflows(
	directory: string,
	definitions: readonly WorkflowDefinition[],
	keys: ReadonlyMap<string, string>,
	force: boolean,
	baselines: Readonly<Record<string, string>> = {},
): SdkPullWrite {
	const root = resolve(directory);
	assertNoSymlinkInPath(root);
	if (existsSync(root)) {
		const stat = lstatSync(root);
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(
				`${directory} must be a real directory, not a file or symlink.`,
			);
		}
	}
	const planned = new Set<string>();
	const plans = definitions.map((definition) => {
		const slug = validateWorkflowSlug(keys.get(definition.id) ?? definition.id);
		if (planned.has(slug)) {
			throw new Error(`More than one workflow resolves to ${slug}.`);
		}
		planned.add(slug);
		const file = join(root, `${slug}.ts`);
		if (dirname(resolve(file)) !== root) {
			throw new Error(`Workflow ${slug} resolves outside ${directory}.`);
		}
		const source =
			definition.authoredSource ??
			sdkWorkflowSource({ ...definition, id: slug });
		const hash = workflowSourceHash(source);
		if (existsSync(file)) {
			const stat = lstatSync(file);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				throw new Error(`${file} must be a real file, not a symlink.`);
			}
			const current = readFileSync(file, "utf8");
			const currentHash = workflowSourceHash(current);
			if (current === source) {
				return { file, source, slug, hash, unchanged: true };
			}
			if (!force && currentHash !== baselines[slug]) {
				throw new Error(
					`${file} has local edits. Run tripwire workflows diff ${slug} first, or pass --force to replace that file.`,
				);
			}
		}
		return { file, source, slug, hash, unchanged: false };
	});
	mkdirSync(root, { recursive: true });
	const files: string[] = [];
	const unchanged: string[] = [];
	for (const plan of plans) {
		if (plan.unchanged) {
			unchanged.push(plan.file);
			continue;
		}
		writeFileSync(plan.file, plan.source, {
			flag: existsSync(plan.file) ? "w" : "wx",
		});
		files.push(plan.file);
	}
	return {
		files,
		unchanged,
		hashes: Object.fromEntries(plans.map(({ slug, hash }) => [slug, hash])),
	};
}

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

const sdkWorkflowSchema = z.union([
	z.object({
		kind: z.literal("workflow"),
		spec: z.unknown(),
		identity: z.unknown().optional(),
	}),
	z.object({ kind: z.literal("workflow"), definition: z.unknown() }),
]);

const sdkCompileResultSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), definition: z.unknown() }),
	z.object({
		ok: z.literal(false),
		issues: z.array(
			z.object({
				message: z.string(),
				path: z.string().optional(),
			}),
		),
	}),
]);

async function compileSdkWorkflow(
	path: string,
	value: z.infer<typeof sdkWorkflowSchema>,
): Promise<CompileResult> {
	const slug = basename(path, extname(path));
	let sdkPath: string;
	try {
		sdkPath = createRequire(pathToFileURL(path)).resolve(
			"@tripwire-sh/sdk/workflows",
		);
	} catch {
		throw new Error(
			`Cannot load @tripwire-sh/sdk/workflows from ${path}. Install @tripwire-sh/sdk in this project.`,
		);
	}
	const sdk: unknown = await import(pathToFileURL(sdkPath).href);
	if (
		typeof sdk !== "object" ||
		sdk === null ||
		!("compileWorkflow" in sdk) ||
		typeof sdk.compileWorkflow !== "function"
	) {
		throw new Error(
			`The @tripwire-sh/sdk/workflows installed for ${path} does not export compileWorkflow.`,
		);
	}
	const compiled = sdkCompileResultSchema.parse(
		sdk.compileWorkflow(slug, value),
	);
	if (!compiled.ok) {
		return {
			ok: false,
			definitions: [],
			issues: compiled.issues.map((issue) => ({
				workflow: slug,
				...(issue.path === undefined ? {} : { step: issue.path }),
				message: issue.message,
			})),
		};
	}
	const definition = workflowDefinitionSchema.safeParse(compiled.definition);
	if (!definition.success) {
		return {
			ok: false,
			definitions: [],
			issues: definition.error.issues.map((issue) => ({
				workflow: slug,
				step: issue.path.join("."),
				message: issue.message,
			})),
		};
	}
	return { ok: true, definitions: [definition.data] };
}

export interface LoadedWorkflowFile {
	format: "legacy" | "sdk";
	result: CompileResult;
	source?: string;
}

export async function loadWorkflowFileWithFormat(
	file: string,
): Promise<LoadedWorkflowFile> {
	const path = resolve(file);
	if (!existsSync(path)) {
		throw new Error(
			`No ${file} here. Run tripwire workflows pull --repo <repo> to get workflow files.`,
		);
	}
	if (!canLoadTypeScript()) {
		throw new Error(
			"Loading TypeScript workflows needs Node 22.18 or later, or Bun. Run it with bunx @tripwire-sh/cli instead.",
		);
	}
	const moduleText = join(dirname(path), AUTHORING_MODULE_PATH);
	const source = readFileSync(path, "utf8");
	if (source.includes(AUTHORING_MODULE_PATH) && !existsSync(moduleText)) {
		writeAuthoringModule(path);
	}
	const url = `${pathToFileURL(path).href}?at=${Date.now()}`;
	const workflowModule: unknown = await import(url);
	if (
		typeof workflowModule === "object" &&
		workflowModule !== null &&
		"default" in workflowModule
	) {
		const sdkWorkflow = sdkWorkflowSchema.safeParse(workflowModule.default);
		if (sdkWorkflow.success) {
			return {
				format: "sdk",
				result: await compileSdkWorkflow(path, sdkWorkflow.data),
				source,
			};
		}
	}
	const defaultExport =
		typeof workflowModule === "object" &&
		workflowModule !== null &&
		"default" in workflowModule
			? workflowModule.default
			: undefined;
	return {
		format: "legacy",
		result: compileWorkflowModule({
			default: defaultExport as
				| SettingValue
				| Readonly<Record<string, LegacyWorkflowValue>>,
		}),
	};
}

/** Loads either a legacy workflow collection or one SDK workflow default export. */
export async function loadWorkflowFile(file: string): Promise<CompileResult> {
	return (await loadWorkflowFileWithFormat(file)).result;
}

export type TypecheckResult = { ok: true } | { ok: false; message: string };

/** Type-checks one SDK workflow with the TypeScript installed in its project. */
export async function typecheckSdkWorkflow(
	file: string,
	system: System,
): Promise<TypecheckResult> {
	const path = resolve(file);
	let tscPath: string;
	try {
		tscPath = createRequire(pathToFileURL(path)).resolve("typescript/bin/tsc");
	} catch {
		return {
			ok: false,
			message: `Cannot type-check ${file}. Install TypeScript in this project before pushing SDK workflows.`,
		};
	}
	const checked = await system.run(process.execPath, [
		tscPath,
		"--noEmit",
		"--pretty",
		"false",
		"--strict",
		"--exactOptionalPropertyTypes",
		"--skipLibCheck",
		"--target",
		"ES2022",
		"--module",
		"NodeNext",
		"--moduleResolution",
		"NodeNext",
		path,
	]);
	if (checked.ok) {
		return { ok: true };
	}
	return {
		ok: false,
		message:
			checked.stderr || checked.stdout || `TypeScript could not check ${file}.`,
	};
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
	const result = workflowToCode(definition);
	return result.ok ? undefined : `cannot be written as code. ${result.reason}`;
}

export interface ListedWorkflow {
	state?: WorkflowState;
	schedules?: readonly string[];
}

export function workflowChoices(
	workflows: readonly PulledWorkflow[],
	listed: ReadonlyMap<string, ListedWorkflow>,
): PickerItem[] {
	return workflows.map((workflow) => {
		const problem = codeProblem(workflow.definition);
		if (problem) {
			return { value: workflow.id, label: workflow.name, disabled: problem };
		}
		const entry = workflow.appId ? listed.get(workflow.appId) : undefined;
		const state = entry?.state ?? (workflow.enabled ? "on" : "off");
		const kinds = workflowTriggerWords(
			triggerKinds(workflow.definition),
			entry?.schedules ?? [],
		);
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
	keys: ReadonlyMap<string, string> = new Map(),
): PullSelection {
	const derived = workflowKeys(
		workflows.map((workflow) => workflow.definition),
		keys,
	);
	const hits = (workflow: PulledWorkflow, key: string) =>
		workflow.id === key ||
		workflow.appId === key ||
		workflow.name === key ||
		derived.get(workflow.id) === key;
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
	keys: Map<string, string>;
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
	| {
			kind: "code";
			format: "legacy" | "sdk";
			text: string;
			definitions: WorkflowDefinition[];
	  }
	| { kind: "unreadable" };

export async function readLocalWorkflows(
	file: string,
): Promise<LocalWorkflows> {
	const path = resolve(file);
	if (!existsSync(path)) {
		return { kind: "none" };
	}
	try {
		const loaded = await loadWorkflowFileWithFormat(file);
		return loaded.result.ok
			? {
					kind: "code",
					format: loaded.format,
					text: readFileSync(path, "utf8"),
					definitions: loaded.result.definitions,
				}
			: { kind: "unreadable" };
	} catch {
		return { kind: "unreadable" };
	}
}

function codeOf(
	definitions: readonly WorkflowDefinition[],
	keys?: ReadonlyMap<string, string>,
): string {
	return workflowsToCode(definitions, {
		importFrom: AUTHORING_MODULE_PATH,
		keys,
	}).code;
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
	keys: ReadonlyMap<string, string>,
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
		return `${listText(differs)} in ${name} ${differs.length === 1 ? "differs" : "differ"} from the server. Run tripwire workflows diff --repo <repo> --file ${name} to compare, or pass --force to take the server's version.`;
	}
	if (codeOf(local.definitions, keys) !== local.text) {
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
	localKeys: ReadonlyMap<string, string> = new Map(),
): PullWrite {
	if (local.kind === "code" && local.format === "sdk") {
		throw new Error(
			`${file} is an SDK workflow. Pull cannot rewrite SDK files yet; choose a legacy tripwire.ts output instead.`,
		);
	}
	const path = resolve(file);
	const merged = mergeDefinitions(
		local.kind === "code" ? local.definitions : [],
		definitions,
	);
	const { code, warnings, written, keys } = workflowsToCode(
		merged.definitions,
		{ importFrom: AUTHORING_MODULE_PATH, keys: localKeys },
	);
	const unchanged = local.kind === "code" && local.text === code;
	const problem =
		force || unchanged ? null : refusal(file, local, definitions, localKeys);
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
		keys,
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
