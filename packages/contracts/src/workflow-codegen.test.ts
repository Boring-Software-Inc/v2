import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountAgeConfigSchema } from "./rules.ts";
import {
	DEFAULT_WORKFLOW,
	type TriggerNode,
	type WorkflowDefinition,
} from "./workflow.ts";
import {
	AUTHORING_MODULE_PATH,
	authoringModuleText,
	schemaTypeText,
	workflowsToCode,
	workflowToCode,
} from "./workflow-codegen.ts";
import { compileWorkflowModule, compileWorkflows } from "./workflow-compile.ts";
import { diffWorkflow, mergeForPush } from "./workflow-diff.ts";
import { workflowAuthoring } from "./workflow-authoring-catalog.ts";
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
			'const oldPrs = check("min-merged-prs", {\n\t\tmin: 2,\n\t}, { version: 1 }).after(t);',
		);
		expect(code).toContain("const either = anyOf(age.fails, oldPrs.fails);");
		expect(code).toContain("const stop = block().after(mod.denied);");
	});

	test("keys are quoted only when they must be, and names read as words", async () => {
		const definition = single(
			"qa-gsimone-opens",
			[
				T,
				{
					id: "honeypot",
					type: "rule",
					ref: "honeypot@1",
					config: { paths: [".github/workflows/**"] },
				},
				{ id: "x", type: "action", action: "block" },
			],
			[
				{ id: "1", from: "t", to: "honeypot" },
				{ id: "2", from: "honeypot", to: "x", when: "fail" },
			],
			"QA gsimone opens",
		);
		const plain = single("rate", definition.nodes, definition.edges, "PR rate");
		const { code, compiled } = await roundTrip([definition, plain]);
		expect(compiled.ok).toBe(true);
		expect(code).toContain("function qaGsimoneOpens() {");
		expect(code).toContain("function prRate() {");
		expect(code).toContain('\t"qa-gsimone-opens": qaGsimoneOpens(),');
		expect(code).toContain("\trate: prRate(),");
		expect(code).toContain(
			'check("honeypot", {\n\t\tpaths: [".github/workflows/**"],\n\t})',
		);
		expect(code).not.toMatch(/"(paths|minDays|min)":/);
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
			"changed step: age.minDays: 30 → 60",
			"removed step: action label",
			"removed connection: mod → ok (Approved)",
		]);
	});

	test("a new workflow is named once, not called new twice", () => {
		expect(diffWorkflow(null, MODERATED)).toEqual([
			{
				change: "added",
				subject: "workflow",
				id: MODERATED.id,
				text: '"Moderated newcomers"',
			},
		]);
	});
});

describe("diffWorkflow names the field a step changed", () => {
	const scheduled = (
		schedule: TriggerNode["schedule"],
	): WorkflowDefinition => ({
		id: "stale",
		name: "Stale",
		version: 1,
		nodes: [
			{
				id: "trigger",
				type: "trigger",
				kinds: ["schedule.matched"],
				schedule,
			},
		],
		edges: [],
	});
	const lines = (
		before: TriggerNode["schedule"],
		after: TriggerNode["schedule"],
	) => diffWorkflow(scheduled(before), scheduled(after)).map((c) => c.text);
	const match = { subjects: ["issue" as const], labels: ["stale"] };

	test("a new time reads back with its zone", () => {
		expect(
			lines(
				{
					every: { preset: "daily", at: "07:00" },
					timezone: "Europe/Berlin",
					match,
				},
				{
					every: { preset: "daily", at: "08:30" },
					timezone: "Europe/Berlin",
					match,
				},
			),
		).toEqual([
			"trigger.every: Every day at 07:00 in Berlin → Every day at 08:30 in Berlin",
		]);
	});

	test("a zone the new time already names gets no line of its own", () => {
		expect(
			lines(
				{ every: { preset: "daily", at: "07:00" }, match },
				{
					every: { preset: "daily", at: "08:30" },
					timezone: "Europe/Berlin",
					match,
				},
			),
		).toEqual([
			"trigger.every: Every day at 07:00 in UTC → Every day at 08:30 in Berlin",
		]);
	});

	test("a zone change alone, and a label change, each get a line", () => {
		expect(
			lines(
				{ every: { n: 12, unit: "hours" }, timezone: "UTC", match },
				{
					every: { n: 12, unit: "hours" },
					timezone: "Europe/Berlin",
					match: { ...match, labels: ["stale", "no-auto-close"] },
				},
			),
		).toEqual([
			"trigger.timezone: UTC → Europe/Berlin",
			"trigger.match.labels: stale → stale, no-auto-close",
		]);
	});

	test("a step that changes kind says what it was", () => {
		const local: WorkflowDefinition = {
			...MODERATED,
			nodes: MODERATED.nodes.map((node) =>
				node.id === "age" ? { id: "age", type: "gate", mode: "not" } : node,
			),
		};
		expect(diffWorkflow(MODERATED, local).map((c) => c.text)).toContain(
			"age: check account-age@1 → gate not",
		);
	});
});

describe("catalog types", () => {
	test("print as plain TypeScript", () => {
		expect(schemaTypeText(accountAgeConfigSchema)).toBe(
			"{\n\treadonly minDays: number;\n}",
		);
	});
});

describe("pull leaves out what code cannot say, and says so", () => {
	test("a gate with no inputs and a repeated id", async () => {
		const draft: WorkflowDefinition = {
			id: "draft",
			name: "Draft",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["comment.created"] },
				{ id: "lonely", type: "gate", mode: "not" },
				{ id: "stop", type: "action", action: "block" },
			],
			edges: [
				{ id: "e1", from: "lonely", to: "stop" },
				{ id: "e2", from: "t", to: "stop" },
			],
		};
		const { warnings, compiled } = await roundTrip([
			draft,
			{ ...draft, name: "Copy" },
		]);
		expect(warnings).toEqual([
			"lonely: a gate with no inputs is left out",
			"Copy: another workflow already uses the id draft, so it is left out",
		]);
		expect(compiled.ok).toBe(true);
		expect(
			workflowsToCode([draft, { ...draft, name: "Copy" }], {
				importFrom: "./x",
			}).written,
		).toEqual(["draft"]);
	});
});

const T = {
	id: "t",
	type: "trigger" as const,
	kinds: ["change-request.opened" as const],
};

function single(
	id: string,
	nodes: WorkflowDefinition["nodes"],
	edges: WorkflowDefinition["edges"],
	name = id,
): WorkflowDefinition {
	return { id, name, version: 1, nodes, edges };
}

const HEALTHY = single(
	"healthy",
	[T, { id: "x", type: "action", action: "block" }],
	[{ id: "1", from: "t", to: "x" }],
);

describe("one bad stored workflow never blocks the push of the rest", () => {
	const broken: WorkflowDefinition[] = [
		single(
			"cycle",
			[
				T,
				{ id: "r1", type: "rule", ref: "crypto-address@1", config: {} },
				{ id: "r2", type: "rule", ref: "crypto-address@1", config: {} },
			],
			[
				{ id: "1", from: "t", to: "r1" },
				{ id: "2", from: "r1", to: "r2" },
				{ id: "3", from: "r2", to: "r1" },
			],
		),
		single(
			"dangling",
			[T, { id: "x", type: "action", action: "block" }],
			[
				{ id: "1", from: "t", to: "x" },
				{ id: "2", from: "gone", to: "x" },
			],
		),
		single(
			"removed-rule",
			[
				T,
				{ id: "r", type: "rule", ref: "first-timer@1", config: {} },
				{ id: "x", type: "action", action: "block" },
			],
			[
				{ id: "1", from: "t", to: "r" },
				{ id: "2", from: "r", to: "x", when: "fail" },
			],
		),
		single(
			"bad-config",
			[
				T,
				{
					id: "r",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: -5 },
				},
				{ id: "x", type: "action", action: "block" },
			],
			[
				{ id: "1", from: "t", to: "r" },
				{ id: "2", from: "r", to: "x", when: "fail" },
			],
		),
		single(
			"draft-schedule",
			[
				{
					id: "s",
					type: "trigger",
					kinds: ["schedule.matched"],
					schedule: { match: { skipLocked: true } },
				},
				{ id: "x", type: "action", action: "close" },
			],
			[{ id: "1", from: "s", to: "x" }],
		),
		single(
			"empty-labels",
			[T, { id: "l", type: "action", action: "label", params: { labels: [] } }],
			[{ id: "1", from: "t", to: "l" }],
		),
		single(
			"legacy-param",
			[
				T,
				{
					id: "l",
					type: "action",
					action: "lock",
					params: { reason: "resolved", extra: 1 },
				},
			],
			[{ id: "1", from: "t", to: "l" }],
		),
		single(
			"not-two-inputs",
			[
				T,
				{ id: "r1", type: "rule", ref: "crypto-address@1", config: {} },
				{ id: "r2", type: "rule", ref: "crypto-address@1", config: {} },
				{ id: "n", type: "gate", mode: "not" },
				{ id: "x", type: "action", action: "block" },
			],
			[
				{ id: "1", from: "t", to: "r1" },
				{ id: "2", from: "t", to: "r2" },
				{ id: "3", from: "r1", to: "n" },
				{ id: "4", from: "r2", to: "n" },
				{ id: "5", from: "n", to: "x" },
			],
		),
		single(
			"schedule-and-events",
			[
				{
					id: "s",
					type: "trigger",
					kinds: ["schedule.matched", "comment.created"],
					schedule: {
						every: { n: 1, unit: "days" },
						match: {
							subjects: ["issue"],
							state: "open",
							inactiveFor: { n: 1, unit: "days" },
							skipLocked: true,
						},
					},
				},
				{ id: "x", type: "action", action: "close" },
			],
			[{ id: "1", from: "s", to: "x" }],
		),
	];

	test("each bad definition is left out with a warning, the rest compiles", async () => {
		const { warnings, compiled } = await roundTrip([HEALTHY, ...broken]);
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) {
			return;
		}
		expect(compiled.definitions.map((definition) => definition.id)).toEqual([
			"healthy",
		]);
		for (const definition of broken) {
			expect(
				warnings.some((warning) =>
					warning.startsWith(`${definition.name}: left out`),
				),
			).toBe(true);
		}
	});
});

describe("pull then push keeps odd ids and names", () => {
	test("ids with spaces or unicode, and reserved words", async () => {
		const reserved = [
			"arguments",
			"eval",
			"package",
			"public",
			"private",
			"protected",
			"interface",
			"implements",
		];
		const definitions = [
			single(
				"spaced",
				[
					{ id: "my trigger", type: "trigger", kinds: ["comment.created"] },
					{ id: "блок", type: "action", action: "block" },
				],
				[{ id: "1", from: "my trigger", to: "блок" }],
				"Package",
			),
			...reserved.map((word) =>
				single(
					`reserved-${word}`,
					[
						T,
						{
							id: word,
							type: "rule",
							ref: "account-age@1",
							config: { minDays: 1 },
						},
						{ id: "x", type: "action", action: "block" },
					],
					[
						{ id: "1", from: "t", to: word },
						{ id: "2", from: word, to: "x", when: "fail" },
					],
					word.charAt(0).toUpperCase() + word.slice(1),
				),
			),
		];
		const { compiled, warnings } = await roundTrip(definitions);
		expect(warnings).toEqual([]);
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) {
			return;
		}
		for (const [index, original] of definitions.entries()) {
			const back = compiled.definitions[index];
			expect(
				back && diffWorkflow(original, mergeForPush(original, back)),
			).toEqual([]);
		}
	});
});

describe("round trip keeps the meaning of what it writes", () => {
	test("a step nothing leads into is left out, never wired to the triggers", async () => {
		const definition = single(
			"orphan",
			[
				T,
				{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 1 } },
				{ id: "x", type: "action", action: "block" },
				{
					id: "ok",
					type: "action",
					action: "label",
					params: { labels: ["ok"] },
				},
			],
			[
				{ id: "1", from: "r", to: "x", when: "fail" },
				{ id: "2", from: "t", to: "ok" },
			],
		);
		const { compiled, warnings } = await roundTrip([definition]);
		expect(warnings).toEqual([
			"r: nothing leads into it, so it is left out",
			"x: nothing leads into it, so it is left out",
		]);
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) {
			return;
		}
		expect(compiled.definitions[0]?.nodes.map((node) => node.id)).toEqual([
			"t",
			"ok",
		]);
	});

	test("a null rule config stays null", async () => {
		const definition = single(
			"null-config",
			[
				T,
				{ id: "r", type: "rule", ref: "crypto-address@1", config: null },
				{ id: "x", type: "action", action: "block" },
			],
			[
				{ id: "1", from: "t", to: "r" },
				{ id: "2", from: "r", to: "x", when: "fail" },
			],
		);
		const { compiled } = await roundTrip([definition]);
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) {
			return;
		}
		const back = compiled.definitions[0];
		if (!back) {
			throw new Error("missing");
		}
		const merged = mergeForPush(definition, back);
		expect(diffWorkflow(definition, merged)).toEqual([]);
		expect(merged.nodes.find((node) => node.id === "r")).toMatchObject({
			config: null,
		});
	});
});

describe("diff ignores the key order Postgres stores", () => {
	const AUTHORED = `import { block, check, trigger, workflow, workflows } from "./workflow.ts";

function rate() {
	const t = trigger("change-request.opened");
	const limit = check("pr-rate-limit", { maxPerWindow: 5, windowHours: 24 }).after(t);
	const stop = block().after(limit.fails);
	return workflow({ name: "Rate", steps: { t, limit, stop } });
}

export default workflows({ rate: rate() });
`;
	const stored: WorkflowDefinition = {
		id: "rate",
		name: "Rate",
		version: 4,
		nodes: [
			{ type: "trigger", id: "t", kinds: ["change-request.opened"] },
			{
				config: { windowHours: 24, maxPerWindow: 5 },
				ref: "pr-rate-limit@1",
				type: "rule",
				id: "limit",
			},
			{ type: "action", id: "stop", action: "block" },
		],
		edges: [
			{ id: "1", from: "t", to: "limit" },
			{ id: "2", from: "limit", to: "stop", when: "fail" },
		],
	};

	async function authored(): Promise<WorkflowDefinition> {
		const file = join(dir, `authored-${counter++}.ts`);
		writeFileSync(file, AUTHORED);
		const compiled = compileWorkflowModule(await import(file));
		if (!compiled.ok || !compiled.definitions[0]) {
			throw new Error("authored module did not compile");
		}
		return compiled.definitions[0];
	}

	test("a reordered rule config is no change", async () => {
		const local = await authored();
		expect(diffWorkflow(stored, local)).toEqual([]);
		expect(diffWorkflow(stored, mergeForPush(stored, local))).toEqual([]);
	});

	test("a real config change names the field, never the bare step", async () => {
		const local = await authored();
		const server: WorkflowDefinition = {
			...stored,
			nodes: stored.nodes.map((node) =>
				node.id === "limit" && node.type === "rule"
					? { ...node, config: { windowHours: 24, maxPerWindow: 3 } }
					: node,
			),
		};
		expect(diffWorkflow(server, local).map((change) => change.text)).toEqual([
			"limit.maxPerWindow: 3 → 5",
		]);
	});

	test("nested values compare without their key order", () => {
		const reviewers = (order: "id-first" | "login-first"): WorkflowDefinition =>
			single(
				"ask",
				[
					T,
					{
						id: "ask",
						type: "action",
						action: "request-review",
						params: {
							reviewers: [
								order === "id-first"
									? { id: 1, login: "octocat" }
									: { login: "octocat", id: 1 },
							],
						},
					},
				],
				[{ id: "1", from: "t", to: "ask" }],
			);
		expect(
			diffWorkflow(reviewers("id-first"), reviewers("login-first")),
		).toEqual([]);
	});
});

const MARK_STALE: WorkflowDefinition = {
	id: "mark-stale-issues",
	name: "Mark stale issues",
	version: 1,
	nodes: [
		{
			id: "warn",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: { preset: "weekdays", at: "09:00" },
				timezone: "Europe/Berlin",
				match: {
					subjects: ["issue"],
					state: "open",
					inactiveFor: { n: 30, unit: "days" },
					excludeLabels: ["keep-open"],
					skipLocked: true,
				},
			},
		},
		{
			id: "mark-stale",
			type: "action",
			action: "label",
			params: { labels: ["stale"] },
		},
		{
			id: "warn-comment",
			type: "action",
			action: "post-comment",
			params: { message: "No activity in 30 days. Comment to keep it open." },
		},
	],
	edges: [
		{ id: "e1", from: "warn", to: "mark-stale" },
		{ id: "e2", from: "warn", to: "warn-comment" },
	],
};

const MARK_STALE_CODE = `import {
\tlabel,
\tpostComment,
\tschedule,
\tworkflow,
\tworkflows,
} from "./workflow.ts";

function markStaleIssues() {
\tconst warn = schedule({
\t\tevery: {
\t\t\tpreset: "weekdays",
\t\t\tat: "09:00",
\t\t},
\t\ttimezone: "Europe/Berlin",
\t\tmatch: {
\t\t\tsubjects: ["issue"],
\t\t\tstate: "open",
\t\t\tinactiveFor: {
\t\t\t\tn: 30,
\t\t\t\tunit: "days",
\t\t\t},
\t\t\texcludeLabels: ["keep-open"],
\t\t\tskipLocked: true,
\t\t},
\t});
\tconst markStale = label({
\t\tlabels: ["stale"],
\t}).after(warn);
\tconst warnComment = postComment({
\t\tmessage: "No activity in 30 days. Comment to keep it open.",
\t}).after(warn);
\treturn workflow({
\t\tname: "Mark stale issues",
\t\tsteps: {
\t\t\twarn,
\t\t\t"mark-stale": markStale,
\t\t\t"warn-comment": warnComment,
\t\t},
\t});
}

export default workflows({
\t"mark-stale-issues": markStaleIssues(),
});
`;

const authoring = workflowAuthoring;

function fixtureDefinitions(): WorkflowDefinition[] {
	const noNewbs = () => authoring.check("account-age", { minDays: 7 });
	const rateLimit = () =>
		authoring.check("pr-rate-limit", { maxPerWindow: 5, windowHours: 24 });
	const review = authoring.humanReview({
		approve: [authoring.label({ labels: ["reviewed"] })],
		deny: [authoring.lock({ reason: "spam" }), authoring.close()],
	});
	const compiled = compileWorkflows(
		authoring.workflows({
			"change-request-opens": authoring.workflow({
				on: "change-request.opened",
				check: authoring.anyOf(noNewbs().fails, rateLimit().fails),
				pass: [authoring.block()],
				fail: [authoring.requestReview({ reviewers: ["gsimone"] })],
			}),
			"someone-comments": authoring.workflow({
				on: "comment.created",
				check: authoring.check("ai-review", { maxSteps: 12 }),
				fail: [authoring.block()],
			}),
			ci: authoring.workflow({
				name: "pull request checks",
				on: ["change-request.opened", "change-request.updated"],
				check: authoring.allOf(
					authoring.check("max-files-changed", { max: 200 }),
					authoring.check("english-only"),
					authoring.check("crypto-address"),
				),
				pass: [authoring.label({ labels: ["ready"] })],
				fail: [
					authoring.block(),
					authoring.postComment({ message: "Checks did not pass." }),
				],
			}),
			triage: authoring.workflow({
				on: "comment.created",
				check: authoring.check("ai-review", { maxSteps: 12 }),
				fail: [review],
			}),
			digest: authoring.workflow({
				on: authoring.schedule({
					every: { cron: "0 8 * * 0" },
					timezone: "Europe/Berlin",
					match: {
						subjects: ["issue", "change-request"],
						state: "open",
						inactiveFor: { n: 30, unit: "days" },
					},
				}),
				run: [authoring.postComment({ message: "Still working on this?" })],
			}),
		}),
	);
	if (!compiled.ok) {
		throw new Error(compiled.issues.map((issue) => issue.message).join("; "));
	}
	return compiled.definitions;
}

describe("short literal arrays print inline", () => {
	test("a schedule workflow reads like the file a person would write", async () => {
		const { code, compiled } = await roundTrip([MARK_STALE]);
		expect(code).toBe(MARK_STALE_CODE);
		expect(compiled.ok).toBe(true);
		if (compiled.ok) {
			expect(
				diffWorkflow(MARK_STALE, compiled.definitions[0] ?? MARK_STALE),
			).toEqual([]);
		}
	});

	test("an array too long for one line prints one item per line", () => {
		const labels = Array.from({ length: 8 }, (_, n) => `needs-triage-${n}`);
		const { code } = workflowsToCode(
			[
				single(
					"long",
					[
						T,
						{ id: "tag", type: "action", action: "label", params: { labels } },
					],
					[{ id: "1", from: "t", to: "tag" }],
				),
			],
			{ importFrom: "./workflow.ts" },
		);
		expect(code).toContain(
			`\t\tlabels: [\n${labels.map((label) => `\t\t\t${JSON.stringify(label)},`).join("\n")}\n\t\t],`,
		);
		for (const line of code.split("\n")) {
			expect(line.replaceAll("\t", "  ").length).toBeLessThanOrEqual(80);
		}
	});

	test("an array that holds objects keeps one item per line", () => {
		const { code } = workflowsToCode(
			[
				single(
					"nested",
					[
						T,
						{
							id: "custom-x",
							type: "rule",
							ref: "custom-x@1",
							config: { pairs: [{ a: 1 }] },
						},
						{ id: "x", type: "action", action: "block" },
					],
					[
						{ id: "1", from: "t", to: "custom-x" },
						{ id: "2", from: "custom-x", to: "x", when: "fail" },
					],
				),
			],
			{ importFrom: "./workflow.ts" },
		);
		expect(code).toContain(
			"pairs: [\n\t\t\t{\n\t\t\t\ta: 1,\n\t\t\t},\n\t\t],",
		);
	});

	test("printing is stable: pull, push, pull gives the same file", async () => {
		const definitions = [
			...WORKFLOW_TEMPLATES.map((template) => template.definition),
			...fixtureDefinitions(),
			MARK_STALE,
		];
		const first = await roundTrip(definitions);
		expect(first.compiled.ok).toBe(true);
		if (!first.compiled.ok) {
			return;
		}
		const second = workflowsToCode(first.compiled.definitions, {
			importFrom: "./workflow.ts",
		});
		expect(second.code).toBe(first.code);
	});

	test("the test fixtures survive the round trip", async () => {
		const definitions = fixtureDefinitions();
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
});

describe("workflowToCode is the file pull writes for one workflow", () => {
	test("same text as pull, never a secret", () => {
		const result = workflowToCode(MODERATED);
		expect(result).toEqual({
			ok: true,
			code: workflowsToCode([MODERATED], { importFrom: AUTHORING_MODULE_PATH })
				.code,
			warnings: [],
		});
		expect(JSON.stringify(result)).not.toContain("example.com");
	});

	test("a gate fed by an event says why it cannot be code", () => {
		const result = workflowToCode(
			single(
				"fed",
				[
					T,
					{
						id: "age",
						type: "rule",
						ref: "account-age@1",
						config: { minDays: 3 },
					},
					{ id: "both", type: "gate", mode: "all-of" },
					{ id: "x", type: "action", action: "block" },
				],
				[
					{ id: "1", from: "t", to: "age" },
					{ id: "2", from: "t", to: "both" },
					{ id: "3", from: "both", to: "x" },
				],
			),
		);
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.reason).toContain("takes rule results");
	});
});
