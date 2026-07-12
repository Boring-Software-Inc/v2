import { describe, expect, test } from "bun:test";
import { BASELINE_RULE_REFS, ruleExecutes } from "./rule-execution.ts";

/**
 * The /rules toggle must show what derive.ts will EXECUTE (Unit 2 residual):
 * a fresh repo runs its baseline rules even with an empty rule_configs, so
 * `enabled ?? false` under-reported. This predicate mirrors
 * deriveDefaultWorkflow's overlay rules.
 */
describe("ruleExecutes — display matches derive.ts execution", () => {
	const baseline = [...BASELINE_RULE_REFS][0] as string;
	const nonBaseline = "profile-readme@1";

	test("baseline set is non-empty and excludes opt-in-only rules", () => {
		expect(BASELINE_RULE_REFS.size).toBeGreaterThan(0);
		expect(BASELINE_RULE_REFS.has("account-age@1")).toBe(true);
		expect(BASELINE_RULE_REFS.has(nonBaseline)).toBe(false);
	});

	test("baseline rule with NO explicit row shows ON", () => {
		expect(ruleExecutes(baseline, undefined)).toBe(true);
	});

	test("baseline rule explicitly disabled shows OFF", () => {
		expect(ruleExecutes(baseline, false)).toBe(false);
	});

	test("non-baseline rule with NO row shows OFF (not opted in)", () => {
		expect(ruleExecutes(nonBaseline, undefined)).toBe(false);
	});

	test("non-baseline rule explicitly enabled shows ON", () => {
		expect(ruleExecutes(nonBaseline, true)).toBe(true);
	});
});
