import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type RuleResult } from "@tripwire/contracts";
import { fixtureEvent } from "../rules/test-context.ts";
import { deriveDefaultWorkflow, type RuleToggle } from "./derive.ts";
import { executeWorkflow } from "./executor.ts";
import { validateWorkflow } from "./validate.ts";

const legacyRefs = DEFAULT_WORKFLOW.nodes
	.filter((n): n is Extract<typeof n, { type: "rule" }> => n.type === "rule")
	.map((n) => n.ref);

function refsOf(def: ReturnType<typeof deriveDefaultWorkflow>): string[] {
	return def.nodes
		.filter((n): n is Extract<typeof n, { type: "rule" }> => n.type === "rule")
		.map((n) => n.ref);
}

const clock = () => new Date(1_752_000_000_000).toISOString();

describe("deriveDefaultWorkflow", () => {
	test("no toggles ⇒ a valid trigger-only workflow: nothing is on by default", () => {
		const def = deriveDefaultWorkflow([]);
		expect(validateWorkflow(def).valid).toBe(true);
		expect(def.id).toBe(DEFAULT_WORKFLOW.id);
		expect(refsOf(def)).toEqual([]);
		expect(def.nodes.some((n) => n.type === "gate")).toBe(false);
	});

	test("enabled toggles run, disabled ones do not", () => {
		const def = deriveDefaultWorkflow([
			{ ref: "account-age@1", enabled: true, config: { minDays: 90 } },
			{ ref: "honeypot@1", enabled: false, config: {} },
		]);
		expect(refsOf(def)).toEqual(["account-age@1"]);
		const node = def.nodes.find(
			(n) => n.type === "rule" && n.ref === "account-age@1",
		) as Extract<(typeof def.nodes)[number], { type: "rule" }>;
		expect(node.config).toEqual({ minDays: 90 });
		expect(validateWorkflow(def).valid).toBe(true);
	});

	test("the stored version is the one that runs", () => {
		const def = deriveDefaultWorkflow([
			{ ref: "account-age@2", enabled: true, config: { minDays: 30 } },
		]);
		expect(refsOf(def)).toEqual(["account-age@2"]);
	});

	test("rules run in catalog order whatever order the rows come in", () => {
		const toggles: RuleToggle[] = [
			{ ref: "english-only@1", enabled: true, config: {} },
			{ ref: "custom-b@1", enabled: true, config: {} },
			{ ref: "account-age@1", enabled: true, config: {} },
			{ ref: "custom-a@1", enabled: true, config: {} },
		];
		expect(refsOf(deriveDefaultWorkflow(toggles))).toEqual([
			"account-age@1",
			"english-only@1",
			"custom-a@1",
			"custom-b@1",
		]);
		expect(refsOf(deriveDefaultWorkflow([...toggles].reverse()))).toEqual(
			refsOf(deriveDefaultWorkflow(toggles)),
		);
	});

	test("ai-review is off until enabled (§8)", () => {
		expect(refsOf(deriveDefaultWorkflow([]))).not.toContain("ai-review@1");
		const def = deriveDefaultWorkflow([
			{ ref: "ai-review@1", enabled: true, config: { maxSteps: 12 } },
		]);
		expect(refsOf(def)).toContain("ai-review@1");
	});

	test("excluded rule ids (owned by a saved workflow) are left out of the derivation", () => {
		const def = deriveDefaultWorkflow(
			[
				{ ref: "account-age@1", enabled: true, config: {} },
				{ ref: "min-merged-prs@1", enabled: true, config: { min: 5 } },
			],
			new Set(["min-merged-prs"]),
		);
		expect(refsOf(def)).toEqual(["account-age@1"]);
		expect(validateWorkflow(def).valid).toBe(true);
	});

	test("all rules disabled ⇒ trigger-only workflow ⇒ verdict pass", async () => {
		const toggles: RuleToggle[] = legacyRefs.map((ref) => ({
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

describe("forge-aware derivation", () => {
	const legacyToggles: RuleToggle[] = legacyRefs.map((ref) => ({
		ref,
		enabled: true,
		config: {},
	}));
	const refs = (wf: ReturnType<typeof deriveDefaultWorkflow>) =>
		wf.nodes.flatMap((node) => (node.type === "rule" ? [node.ref] : []));

	test("a rule the forge cannot run is left out, not added and skipped", () => {
		const onGithub = deriveDefaultWorkflow(legacyToggles, undefined, "github");
		const onOpenGit = deriveDefaultWorkflow(
			legacyToggles,
			undefined,
			"opengit",
		);
		expect(refs(onGithub).length).toBeGreaterThan(refs(onOpenGit).length);
		expect(refs(onOpenGit).some((ref) => ref.startsWith("english-only@"))).toBe(
			true,
		);
		expect(refs(onOpenGit).some((ref) => ref.startsWith("account-age@"))).toBe(
			false,
		);
	});

	test("omitting the forge filters nothing", () => {
		const unfiltered = deriveDefaultWorkflow(legacyToggles);
		const onGithub = deriveDefaultWorkflow(legacyToggles, undefined, "github");
		expect(unfiltered.nodes.length).toBe(onGithub.nodes.length);
	});

	test("an opt-in toggle for an unsupported rule is refused too", () => {
		const wf = deriveDefaultWorkflow(
			[{ ref: "crypto-address@1", enabled: true, config: {} }],
			undefined,
			"opengit",
		);
		expect(
			wf.nodes.some(
				(node) => node.type === "rule" && node.ref.startsWith("crypto-address"),
			),
		).toBe(false);
	});
});

describe("standalone rules", () => {
	test("every installed rule feeds one gate that blocks on fail", () => {
		const def = deriveDefaultWorkflow([
			{ ref: "account-age@1", enabled: true, config: { minDays: 7 } },
			{ ref: "crypto-address@1", enabled: true, config: {} },
		]);
		expect(validateWorkflow(def).valid).toBe(true);
		expect(def.nodes.map((node) => node.id)).toEqual([
			"trigger",
			"rule-0",
			"rule-1",
			"gate",
			"block",
		]);
		expect(
			def.nodes.flatMap((node) =>
				node.type === "action" ? [node.action] : [],
			),
		).toEqual(["block"]);
	});
});
