import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type RuleResult } from "@tripwire/contracts";
import { fixtureEvent } from "../rules/test-context.ts";
import { deriveDefaultWorkflow, type RuleToggle } from "./derive.ts";
import { executeWorkflow } from "./executor.ts";
import { validateWorkflow } from "./validate.ts";

const baselineRefs = DEFAULT_WORKFLOW.nodes
	.filter((n): n is Extract<typeof n, { type: "rule" }> => n.type === "rule")
	.map((n) => n.ref);

function refsOf(def: ReturnType<typeof deriveDefaultWorkflow>): string[] {
	return def.nodes
		.filter((n): n is Extract<typeof n, { type: "rule" }> => n.type === "rule")
		.map((n) => n.ref);
}

const clock = () => new Date(1_752_000_000_000).toISOString();

describe("deriveDefaultWorkflow", () => {
	test("no toggles ⇒ valid workflow reproducing the baseline rule set", () => {
		const def = deriveDefaultWorkflow([]);
		expect(validateWorkflow(def).valid).toBe(true);
		expect(def.id).toBe(DEFAULT_WORKFLOW.id);
		expect(refsOf(def).sort()).toEqual([...baselineRefs].sort());
	});

	test("disabling a baseline rule drops it from the derived graph (§6 kill switch)", () => {
		const target = baselineRefs[0] as string;
		const toggles: RuleToggle[] = [{ ref: target, enabled: false, config: {} }];
		const def = deriveDefaultWorkflow(toggles);
		expect(refsOf(def)).not.toContain(target);
		expect(refsOf(def).length).toBe(baselineRefs.length - 1);
		expect(validateWorkflow(def).valid).toBe(true);
	});

	test("toggle config overrides the baseline config", () => {
		const target = "account-age@1";
		const def = deriveDefaultWorkflow([
			{ ref: target, enabled: true, config: { minDays: 90 } },
		]);
		const node = def.nodes.find(
			(n) => n.type === "rule" && n.ref === target,
		) as Extract<(typeof def.nodes)[number], { type: "rule" }>;
		expect(node.config).toEqual({ minDays: 90 });
	});

	test("an enabled non-baseline rule is opted in", () => {
		const extra = "min-merged-prs@1";
		expect(baselineRefs).not.toContain(extra);
		const def = deriveDefaultWorkflow([
			{ ref: extra, enabled: true, config: { min: 5 } },
		]);
		expect(refsOf(def)).toContain(extra);
	});

	test("all baseline rules disabled ⇒ trigger-only workflow ⇒ verdict pass", async () => {
		const toggles: RuleToggle[] = baselineRefs.map((ref) => ({
			ref,
			enabled: false,
			config: {},
		}));
		const def = deriveDefaultWorkflow(toggles);
		expect(refsOf(def)).toEqual([]);
		expect(def.nodes.some((n) => n.type === "gate")).toBe(false);
		expect(validateWorkflow(def).valid).toBe(true);

		const result = await executeWorkflow({
			definition: def,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: (ref): Promise<RuleResult> =>
				Promise.resolve({
					ruleId: ref.split("@")[0] as string,
					version: 1,
					status: "evaluated",
					passed: false,
					evidence: {},
					evaluatedAt: clock(),
				}),
			now: clock,
		});
		expect(result.verdict).toBe("pass");
	});
});
