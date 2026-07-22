import { describe, expect, test } from "bun:test";
import {
	type CustomRuleRecord,
	customCatalogEntry,
	customRuleDefinitionSchema,
	customRuleRecordSchema,
	customRuleRef,
	resolveCatalog,
} from "./custom-rules.ts";
import { RULE_CATALOG } from "./rules.ts";
import { validateWorkflowForEnable } from "./workflow-validate.ts";

const forkRate: CustomRuleRecord = {
	id: "custom-fork-rate",
	name: "fork spray",
	enabled: true,
	definition: {
		when: {
			id: "contributor.recentForkTimes",
			transform: { kind: "lastCount", window: "24h" },
		},
		comparison: { kind: "atMost", args: [20] },
		severity: "high",
	},
};

describe("stored definition schema", () => {
	test("a definition survives an actual JSON round trip", () => {
		const parsed = customRuleRecordSchema.parse(
			JSON.parse(JSON.stringify(forkRate)),
		);
		expect(parsed).toEqual(forkRate);
	});

	test("user-regex verbs are not in the v1 vocabulary", () => {
		for (const kind of ["matches", "scan", "empty"]) {
			const result = customRuleDefinitionSchema.safeParse({
				...forkRate.definition,
				comparison: { kind, args: [] },
			});
			expect(result.success).toBe(false);
		}
	});

	test("not nests exactly one level", () => {
		expect(
			customRuleDefinitionSchema.safeParse({
				...forkRate.definition,
				comparison: {
					kind: "not",
					args: [{ kind: "under", args: [3] }],
				},
			}).success,
		).toBe(true);
		expect(
			customRuleDefinitionSchema.safeParse({
				...forkRate.definition,
				comparison: {
					kind: "not",
					args: [{ kind: "not", args: [{ kind: "under", args: [3] }] }],
				},
			}).success,
		).toBe(false);
	});

	test("ids must carry the custom prefix", () => {
		expect(
			customRuleRecordSchema.safeParse({ ...forkRate, id: "account-age" })
				.success,
		).toBe(false);
	});
});

describe("runtime catalog", () => {
	test("built-ins and custom rules resolve into one catalog", () => {
		const catalog = resolveCatalog([forkRate]);
		expect(catalog).toHaveLength(RULE_CATALOG.length + 1);
		const entry = catalog.find((e) => e.ruleId === "custom-fork-rate");
		expect(entry?.name).toBe("fork spray");
		expect(entry?.version).toBe(1);
		expect(entry?.source).toBe("custom");
		// The rule IS the config: node config is empty and parses.
		expect(entry?.configSchema.safeParse({}).success).toBe(true);
		// Built-ins keep their identity through the merge.
		const builtIn = catalog.find((e) => e.ruleId === "account-age");
		expect(builtIn?.source).toBe("built-in");
		expect(builtIn?.name).toBe("account age");
	});

	test("every consumer field a built-in entry carries exists on a custom entry", () => {
		const custom = customCatalogEntry(forkRate);
		const builtIn = resolveCatalog([])[0];
		if (!builtIn) {
			throw new Error("catalog empty");
		}
		for (const key of Object.keys(builtIn)) {
			if (key === "changeNote") {
				continue;
			}
			expect(custom).toHaveProperty(key);
		}
	});
});

describe("enable-time validation over the runtime catalog", () => {
	const workflow = (ref: string) => ({
		id: "wf-1",
		name: "gate",
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: ["change-request.opened"],
				position: { x: 0, y: 0 },
			},
			{ id: "r", type: "rule", ref, config: {}, position: { x: 1, y: 0 } },
			{
				id: "a",
				type: "action",
				action: "block",
				position: { x: 2, y: 0 },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	});

	test("a custom ref validates against the merged catalog", () => {
		const merged = resolveCatalog([forkRate]);
		const result = validateWorkflowForEnable(
			workflow(customRuleRef(forkRate.id)),
			merged,
		);
		expect(result.valid).toBe(true);
	});

	test("the same ref fails against the static catalog alone", () => {
		const result = validateWorkflowForEnable(
			workflow(customRuleRef(forkRate.id)),
		);
		expect(result.valid).toBe(false);
	});
});
