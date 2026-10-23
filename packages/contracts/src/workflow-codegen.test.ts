import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountAgeConfigSchema } from "./rules.ts";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "./workflow.ts";
import {
	authoringModuleText,
	schemaTypeText,
	workflowsToCode,
} from "./workflow-codegen.ts";
import { compileWorkflowModule } from "./workflow-compile.ts";
import { diffWorkflow, mergeForPush } from "./workflow-diff.ts";
import { WORKFLOW_TEMPLATES } from "./workflow-templates.ts";

const dir = mkdtempSync(join(tmpdir(), "tripwire-codegen-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const source = await Bun.file(
	new URL("./workflow-authoring.ts", import.meta.url),
).text();
writeFileSync(join(dir, "workflow.ts"), authoringModuleText(source));

let counter = 0;

async function roundTrip(definitions: readonly WorkflowDefinition[]) {
	const { code, warnings } = workflowsToCode(definitions, {
		importFrom: "./workflow.ts",
	});
	const file = join(dir, `tripwire-${counter++}.ts`);
	writeFileSync(file, code);
	const compiled = compileWorkflowModule(await import(file));
	return { code, warnings, compiled, file };
}

const MODERATED: WorkflowDefinition = {
	id: "moderated",
	name: "Moderated newcomers",
	version: 3,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "age", type: "rule", ref: "account-age@1", config: { minDays: 30 } },
		{
			id: "old-prs",
			type: "rule",
			ref: "min-merged-prs@1",
			config: { min: 2 },
		},
		{ id: "either", type: "gate", mode: "any-of" },
		{ id: "mod", type: "action", action: "send-to-moderation" },
		{
			id: "hook",
			type: "action",
			action: "webhook",
			params: { url: "https://example.com/hook", urlSet: true },
		},
		{ id: "stop", type: "action", action: "block" },
		{
			id: "ok",
			type: "action",
			action: "label",
			params: { labels: ["trusted"] },
		},
	],
	edges: [
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "t", to: "old-prs" },
		{ id: "e3", from: "age", to: "either", when: "fail" },
		{ id: "e4", from: "old-prs", to: "either", when: "fail" },
		{ id: "e5", from: "either", to: "mod" },
		{ id: "e6", from: "mod", to: "stop", when: "deny" },
		{ id: "e7", from: "mod", to: "ok", when: "approve" },
		{ id: "e8", from: "either", to: "hook" },
	],
};

describe("pull then push changes nothing", () => {
	const cases: [string, WorkflowDefinition[]][] = [
		["the default workflow", [DEFAULT_WORKFLOW]],
		[
			"every template",
			WORKFLOW_TEMPLATES.map((template) => template.definition),
		],
		["human review, pinned versions and secrets", [MODERATED]],
	];
	for (const [name, definitions] of cases) {
		test(name, async () => {
			const { compiled, warnings } = await roundTrip(definitions);
			expect(warnings).toEqual([]);
			expect(compiled.ok).toBe(true);
			if (!compiled.ok) {
				return;
			}
			for (const [index, original] of definitions.entries()) {
				const back = compiled.definitions[index];
				expect(back && diffWorkflow(original, back)).toEqual([]);
			}
		});
	}

	test("pulled code never carries a secret", async () => {
		const { code } = await roundTrip([MODERATED]);
		expect(code).not.toContain("example.com");
		expect(code).toContain("webhook().after(either)");
	});

	test("the pulled module reads like hand-written code", async () => {
		const { code } = await roundTrip([MODERATED]);
		expect(code).toContain(
			'const oldPrs = check("min-merged-prs", {\n\t\t"min": 2\n\t}, { version: 1 }).after(t);',
		);
		expect(code).toContain("const either = anyOf(age.fails, oldPrs.fails);");
		expect(code).toContain("const stop = block().after(mod.denied);");
	});

	test("node can load the module with type stripping alone", async () => {
		const node = Bun.which("node");
		const version = node ? (await Bun.$`${node} --version`.text()).trim() : "";
		const [major = 0, minor = 0] = version
			.replace("v", "")
			.split(".")
			.map(Number);
		if (!node || major < 22 || (major === 22 && minor < 18)) {
			return;
		}
		const { file } = await roundTrip([MODERATED]);
		const runner = join(dir, "run.mjs");
		writeFileSync(
			runner,
			`const m = await import(${JSON.stringify(file)});\nconsole.log(Object.keys(m.default).join(","));\n`,
		);
		expect((await Bun.$`${node} ${runner}`.text()).trim()).toBe("moderated");
	});
});

describe("push keeps what code does not carry", () => {
	test("positions and secrets survive, the graph is the code's", () => {
		const server: WorkflowDefinition = {
			...MODERATED,
			nodes: MODERATED.nodes.map((node) => ({
				...node,
				position: { x: 1, y: 2 },
			})),
		};
		const local: WorkflowDefinition = {
			...MODERATED,
			version: 1,
			nodes: MODERATED.nodes.map((node) =>
				node.id === "hook"
					? { id: "hook", type: "action", action: "webhook" }
					: node,
			),
		};
		const merged = mergeForPush(server, local);
		expect(merged.version).toBe(3);
		expect(merged.nodes.find((node) => node.id === "hook")).toEqual({
			id: "hook",
			type: "action",
			action: "webhook",
			position: { x: 1, y: 2 },
			params: { url: "https://example.com/hook", urlSet: true },
		});
	});
});

describe("diffWorkflow", () => {
	test("names what a push would change", () => {
		const local: WorkflowDefinition = {
			...MODERATED,
			name: "Renamed",
			nodes: MODERATED.nodes
				.filter((node) => node.id !== "ok")
				.map((node) =>
					node.id === "age" ? { ...node, config: { minDays: 60 } } : node,
				),
			edges: MODERATED.edges.filter((edge) => edge.to !== "ok"),
		};
		expect(
			diffWorkflow(MODERATED, local).map(
				(change) => `${change.change} ${change.subject}: ${change.text}`,
			),
		).toEqual([
			"changed workflow: name Moderated newcomers → Renamed",
			"changed step: check account-age@1",
			"removed step: action label",
			"removed connection: mod → ok (Approved)",
		]);
	});
});

describe("catalog types", () => {
	test("print as plain TypeScript", () => {
		expect(schemaTypeText(accountAgeConfigSchema)).toBe(
			"{\n\treadonly minDays: number;\n}",
		);
	});
});
