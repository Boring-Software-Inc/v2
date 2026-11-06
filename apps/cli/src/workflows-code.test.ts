import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { workflowDefinitionSchema } from "@tripwire/contracts";
import { realSystem } from "#/system";
import {
	discoverWorkflowFiles,
	initialPicks,
	loadWorkflowFile,
	mergeDefinitions,
	type PulledWorkflow,
	pulledCountText,
	readLocalWorkflows,
	sdkWorkflowSource,
	selectPulled,
	selectWorkflowSources,
	typecheckSdkWorkflow,
	workflowChoices,
	writePulled,
	writeSdkWorkflows,
} from "#/workflows-code";

const SDK_PROJECTS: string[] = [];
const TYPESCRIPT_PACKAGE = dirname(
	createRequire(import.meta.url).resolve("typescript/package.json"),
);

function sdkWorkflowProject(
	validDefinition: boolean,
	typeError = false,
): string {
	const root = mkdtempSync(join(tmpdir(), "tripwire-sdk-workflow-"));
	SDK_PROJECTS.push(root);
	const packageDir = join(root, "node_modules", "@tripwire-sh", "sdk");
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({
			name: "@tripwire-sh/sdk",
			type: "module",
			exports: {
				"./workflows": {
					types: "./workflows.d.ts",
					default: "./workflows.js",
				},
			},
		}),
	);
	writeFileSync(
		join(packageDir, "workflows.d.ts"),
		`export interface EventRef { readonly kind: string; readonly name: string; }
export interface ActionStep { readonly kind: "action"; readonly action: string; }
export interface WorkflowValue { readonly kind: "workflow"; readonly spec: { readonly when: EventRef; readonly run: ActionStep }; }
export function workflow(spec: WorkflowValue["spec"]): WorkflowValue;
export const changeRequest: { readonly opened: EventRef };
export function block(): ActionStep;
export function compileWorkflow(slug: string, value: WorkflowValue): unknown;
`,
	);
	writeFileSync(
		join(packageDir, "workflows.js"),
		`export function workflow(spec) { return { kind: "workflow", spec }; }
export const changeRequest = { opened: { kind: "change-request.opened", name: "changeRequest.opened" } };
export function block() { return { kind: "action", action: "block" }; }
export function compileWorkflow(slug) {
  return { ok: true, definition: ${
		validDefinition
			? `{ id: slug, name: slug, version: 1, nodes: [{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] }, { id: "block", type: "action", action: "block" }], edges: [{ id: "trigger-block", from: "trigger", to: "block" }] }`
			: `{ id: slug, name: slug, version: 1, nodes: [], edges: [] }`
	} };
}`,
	);
	const file = join(root, ".tripwire", "workflows", "new-contributors.ts");
	mkdirSync(dirname(file), { recursive: true });
	symlinkSync(
		TYPESCRIPT_PACKAGE,
		join(root, "node_modules", "typescript"),
		process.platform === "win32" ? "junction" : "dir",
	);
	writeFileSync(
		file,
		`import { block, changeRequest, workflow } from "@tripwire-sh/sdk/workflows";
export default workflow({ when: ${typeError ? "42" : "changeRequest.opened"}, run: block() });
`,
	);
	return file;
}

afterAll(() => {
	for (const root of SDK_PROJECTS) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("loading one SDK workflow", () => {
	test("resolves the project-installed compiler and returns one contracts definition", async () => {
		const compiled = await loadWorkflowFile(sdkWorkflowProject(true));
		expect(compiled.ok).toBe(true);
		expect(compiled.definitions).toHaveLength(1);
		expect(compiled.definitions[0]?.id).toBe("new-contributors");
		expect(
			workflowDefinitionSchema.safeParse(compiled.definitions[0]).success,
		).toBe(true);
	});

	test("rejects SDK output that does not satisfy contracts", async () => {
		const compiled = await loadWorkflowFile(sdkWorkflowProject(false));
		expect(compiled.ok).toBe(false);
		if (!compiled.ok) {
			expect(compiled.issues[0]?.workflow).toBe("new-contributors");
			expect(compiled.issues[0]?.step).toBe("nodes");
		}
	});

	test("pull cannot replace an SDK workflow with legacy collection source", async () => {
		const file = sdkWorkflowProject(true);
		const local = await readLocalWorkflows(file);
		expect(local.kind).toBe("code");
		if (local.kind !== "code") {
			throw new Error("Expected a readable SDK workflow fixture");
		}
		expect(local.format).toBe("sdk");
		expect(() => writePulled(file, local.definitions, true, local)).toThrow(
			"Pull cannot rewrite SDK files yet",
		);
	});

	test("the project TypeScript rejects an SDK workflow before push", async () => {
		const checked = await typecheckSdkWorkflow(
			sdkWorkflowProject(true, true),
			realSystem(process.env, process.platform),
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.message).toContain(
				"Type 'number' is not assignable to type 'EventRef'",
			);
		}
	});
});

describe("SDK workflow directory", () => {
	test("discovers canonical slugs in stable order and selects explicitly", () => {
		const root = mkdtempSync(join(tmpdir(), "tripwire-sdk-discovery-"));
		SDK_PROJECTS.push(root);
		writeFileSync(join(root, "z-last.ts"), "export default {}\n");
		writeFileSync(join(root, "a-first.ts"), "export default {}\n");
		writeFileSync(join(root, "notes.md"), "ignored\n");
		const sources = discoverWorkflowFiles(root);
		expect(sources.map(({ slug }) => slug)).toEqual(["a-first", "z-last"]);
		expect(selectWorkflowSources(sources, ["z-last"])).toEqual(
			sources[1] ? [sources[1]] : [],
		);
		expect(() => selectWorkflowSources(sources, ["missing"])).toThrow(
			"Available workflows: a-first, z-last",
		);
		expect(selectWorkflowSources(sources, ["z-last", "z-last"])).toHaveLength(
			1,
		);
	});

	test("writes one lossless SDK source per workflow without deleting others", () => {
		const root = mkdtempSync(join(tmpdir(), "tripwire-sdk-pull-"));
		SDK_PROJECTS.push(root);
		const first = workflowDefinitionSchema.parse(
			gate("remote-1", "First", ["change-request.opened"]),
		);
		const second = workflowDefinitionSchema.parse(
			gate("remote-2", "Second", ["comment.created"]),
		);
		const keys = new Map([
			["remote-1", "first"],
			["remote-2", "second"],
		]);
		writeFileSync(join(root, "local-only.ts"), "export default {}\n");
		const written = writeSdkWorkflows(root, [first, second], keys, false);
		expect(written.files).toHaveLength(2);
		expect(discoverWorkflowFiles(root).map(({ slug }) => slug)).toEqual([
			"first",
			"local-only",
			"second",
		]);
		writeFileSync(join(root, "first.ts"), "local edit\n");
		expect(() => writeSdkWorkflows(root, [first], keys, false)).toThrow(
			"has local edits",
		);
		writeSdkWorkflows(root, [first], keys, true);
		expect(
			discoverWorkflowFiles(root).some(({ slug }) => slug === "second"),
		).toBe(true);
	});

	test("strips delivery secrets and refuses unsafe object-literal keys", () => {
		const secret = workflowDefinitionSchema.parse({
			id: "delivery",
			name: "Delivery",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["comment.created"] },
				{
					id: "w",
					type: "action",
					action: "webhook",
					params: { url: "https://secret.example", signingSecret: "secret" },
				},
			],
			edges: [{ id: "e", from: "t", to: "w" }],
		});
		const source = sdkWorkflowSource(secret);
		expect(source).not.toContain("secret.example");
		expect(source).not.toContain("signingSecret");
		const unsafe = JSON.parse(JSON.stringify(secret)) as typeof secret;
		Object.defineProperty(
			(unsafe.nodes[1] as { params: Record<string, unknown> }).params,
			"__proto__",
			{ value: "unsafe", enumerable: true },
		);
		expect(() => sdkWorkflowSource(unsafe)).toThrow("contains a __proto__ key");
	});

	test("preflights every selected file before writing any of them", () => {
		const root = mkdtempSync(join(tmpdir(), "tripwire-sdk-preflight-"));
		SDK_PROJECTS.push(root);
		const first = workflowDefinitionSchema.parse(
			gate("one", "One", ["comment.created"]),
		);
		const second = workflowDefinitionSchema.parse(
			gate("two", "Two", ["comment.created"]),
		);
		writeFileSync(join(root, "two.ts"), "local edit\n");
		expect(() =>
			writeSdkWorkflows(
				root,
				[first, second],
				new Map([
					["one", "one"],
					["two", "two"],
				]),
				false,
			),
		).toThrow("has local edits");
		expect(existsSync(join(root, "one.ts"))).toBe(false);
	});

	test("refuses a symlink in the workflow directory path", () => {
		if (process.platform === "win32") {
			return;
		}
		const root = mkdtempSync(join(tmpdir(), "tripwire-sdk-symlink-"));
		SDK_PROJECTS.push(root);
		const actual = join(root, "actual");
		mkdirSync(actual);
		symlinkSync(actual, join(root, ".tripwire"), "dir");
		const definition = workflowDefinitionSchema.parse(
			gate("one", "One", ["comment.created"]),
		);
		expect(() =>
			writeSdkWorkflows(
				join(root, ".tripwire", "workflows"),
				[definition],
				new Map([["one", "one"]]),
				false,
			),
		).toThrow("is a symlink");
	});
});

describe("pull says how many workflows it wrote", () => {
	test("the count is what the file holds", () => {
		expect(pulledCountText({ count: 1, pulled: 1 })).toBe("1 workflow");
		expect(pulledCountText({ count: 5, pulled: 5 })).toBe("5 workflows");
	});

	test("a workflow left out is counted apart, never as written", () => {
		expect(pulledCountText({ count: 5, pulled: 6 })).toBe(
			"5 workflows, 1 left out",
		);
	});
});

const gate = (id: string, name: string, kinds: string[]) => ({
	id,
	name,
	version: 1,
	nodes: [
		{ id: "trigger", type: "trigger" as const, kinds },
		{ id: "block", type: "action" as const, action: "block" as const },
	],
	edges: [{ id: "e1", from: "trigger", to: "block" }],
});

const PULLED: PulledWorkflow[] = [
	{
		id: "new-accounts",
		appId: "w1",
		name: "New accounts",
		enabled: true,
		definition: workflowDefinitionSchema.parse(
			gate("new-accounts", "New accounts", ["change-request.opened"]),
		),
	},
	{
		id: "stale",
		appId: "w2",
		name: "Stale issues",
		enabled: false,
		definition: workflowDefinitionSchema.parse(
			gate("stale", "Stale issues", ["comment.created"]),
		),
	},
];

describe("picking workflows to pull", () => {
	test("each choice shows its state and triggers", () => {
		expect(
			workflowChoices(PULLED, new Map([["w1", { state: "needs-fixes" }]])),
		).toEqual([
			{
				value: "new-accounts",
				label: "New accounts",
				hint: "needs fixes, change request opened",
			},
			{ value: "stale", label: "Stale issues", hint: "off, comment created" },
		]);
	});

	test("a scheduled workflow shows its schedule in the list's words", () => {
		const sweep: PulledWorkflow = {
			id: "stale-sweep",
			appId: "w3",
			name: "Stale sweep",
			enabled: true,
			definition: workflowDefinitionSchema.parse({
				id: "stale-sweep",
				name: "Stale sweep",
				version: 1,
				nodes: [
					{
						id: "trigger",
						type: "trigger",
						kinds: ["schedule.matched"],
						schedule: {
							every: { cron: "*/15 * * * *" },
							timezone: "Europe/Berlin",
							match: {
								subjects: ["issue"],
								state: "open",
								inactiveFor: { n: 30, unit: "days" },
							},
						},
					},
					{ id: "close", type: "action", action: "close" },
				],
				edges: [{ id: "e1", from: "trigger", to: "close" }],
			}),
		};
		expect(
			workflowChoices(
				[sweep],
				new Map([
					["w3", { state: "on", schedules: ["every 15 minutes in Berlin"] }],
				]),
			),
		).toEqual([
			{
				value: "stale-sweep",
				label: "Stale sweep",
				hint: "live, every 15 minutes in Berlin",
			},
		]);
	});

	test("a workflow that cannot be written as code is shown but not pickable", () => {
		const broken = workflowDefinitionSchema.parse({
			id: "broken",
			name: "Broken",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "g", type: "gate", mode: "all-of" },
				{ id: "b", type: "action", action: "block" },
			],
			edges: [
				{ id: "e1", from: "t", to: "g" },
				{ id: "e2", from: "g", to: "b", when: "fail" },
			],
		});
		const [choice] = workflowChoices(
			[{ id: "broken", name: "Broken", enabled: false, definition: broken }],
			new Map(),
		);
		expect(choice?.disabled).toStartWith("cannot be written as code");
	});

	test("the local file's workflows start picked, or every workflow without one", () => {
		const choices = workflowChoices(PULLED, new Map());
		expect(initialPicks(choices, null)).toEqual(["new-accounts", "stale"]);
		expect(initialPicks(choices, ["stale", "gone"])).toEqual(["stale"]);
	});

	test("workflow args match by id, app id or name, and name the unknown ones", () => {
		expect(selectPulled(PULLED, ["w2", "New accounts", "nope"])).toEqual({
			picked: PULLED,
			unknown: ["nope"],
		});
	});

	test("a pulled subset replaces its own workflows and keeps the rest", () => {
		const local = [
			workflowDefinitionSchema.parse(
				gate("local", "Local", ["comment.created"]),
			),
			workflowDefinitionSchema.parse(
				gate("stale", "Old stale", ["comment.created"]),
			),
		];
		const merged = mergeDefinitions(local, [
			PULLED[1]?.definition ?? never(),
			PULLED[0]?.definition ?? never(),
		]);
		expect(merged.definitions.map((definition) => definition.name)).toEqual([
			"Local",
			"Stale issues",
			"New accounts",
		]);
		expect(merged.kept).toEqual(["Local"]);
	});
});

function never(): never {
	throw new Error("missing fixture");
}
