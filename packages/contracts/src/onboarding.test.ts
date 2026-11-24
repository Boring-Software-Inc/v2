import { describe, expect, test } from "bun:test";
import {
	draftOnboardingWorkflow,
	EMPTY_ONBOARDING_ANSWERS,
	onboardingAnswersSchema,
	recommendedRulePicks,
	visibleOnboardingSteps,
} from "./onboarding.ts";
import { RULE_CATALOG } from "./rules.ts";
import {
	validateWorkflow,
	validateWorkflowForEnable,
} from "./workflow-validate.ts";

describe("onboarding answers", () => {
	test("the empty answers satisfy the contract", () => {
		expect(onboardingAnswersSchema.parse(EMPTY_ONBOARDING_ANSWERS)).toEqual(
			EMPTY_ONBOARDING_ANSWERS,
		);
	});
});

describe("visible steps", () => {
	const base = { hasChangeRequests: true, reportedCount: 0, checkDone: false };

	test("a team sees every step", () => {
		expect(visibleOnboardingSteps({ ...base, usage: "team" })).toContain(
			"workspace",
		);
	});

	test("a personal user keeps their personal workspace", () => {
		expect(
			visibleOnboardingSteps({ ...base, usage: "personal" }),
		).not.toContain("workspace");
	});

	test("no stored change requests drops check and workflow", () => {
		const steps = visibleOnboardingSteps({
			...base,
			usage: "team",
			hasChangeRequests: false,
		});
		expect(steps).not.toContain("check");
		expect(steps).not.toContain("workflow");
	});

	test("workflow drops out once check ends with nothing reported", () => {
		const undecided = visibleOnboardingSteps({ ...base, usage: "team" });
		expect(undecided).toContain("workflow");
		const nothing = visibleOnboardingSteps({
			...base,
			usage: "team",
			checkDone: true,
		});
		expect(nothing).not.toContain("workflow");
		const reported = visibleOnboardingSteps({
			...base,
			usage: "team",
			checkDone: true,
			reportedCount: 2,
		});
		expect(reported).toContain("workflow");
	});
});

describe("rule picks", () => {
	test("intents choose the matching picks", () => {
		expect(
			recommendedRulePicks(["crypto-spam", "drive-by-slop"]).map((p) => p.id),
		).toEqual(["crypto-scams", "ai-review"]);
	});

	test("no intents falls back to the basics", () => {
		expect(recommendedRulePicks([]).map((p) => p.id)).toEqual([
			"spam-protection",
			"crypto-scams",
		]);
	});

	test("every pick names rules that exist", () => {
		const known = new Set<string>(RULE_CATALOG.map((rule) => rule.ruleId));
		for (const pick of recommendedRulePicks(["not-sure", "mass-changes"])) {
			for (const ruleId of pick.ruleIds) {
				expect(known.has(ruleId)).toBe(true);
			}
		}
	});
});

describe("drafted workflow", () => {
	test("nothing failed drafts nothing", () => {
		expect(
			draftOnboardingWorkflow({ id: "wf", name: "Drafted", failed: [] }),
		).toBeNull();
	});

	test("failed rules become valid branches, once each", () => {
		const draft = draftOnboardingWorkflow({
			id: "wf",
			name: "Stop airdrop drive-bys",
			failed: [
				{ ruleId: "account-age", config: { minDays: 7 } },
				{ ruleId: "crypto-address", config: {} },
				{ ruleId: "account-age", config: { minDays: 7 } },
				{ ruleId: "not-a-rule", config: {} },
			],
		});
		expect(draft).not.toBeNull();
		if (!draft) {
			return;
		}
		expect(draft.nodes.map((node) => node.id)).toEqual([
			"trigger",
			"account-age",
			"account-age-action",
			"crypto-address",
			"crypto-address-action",
		]);
		const actions = draft.nodes.flatMap((node) =>
			node.type === "action" ? [node.action] : [],
		);
		expect(actions).toEqual(["close", "send-to-moderation"]);
		expect(validateWorkflow(draft).valid).toBe(true);
		expect(validateWorkflowForEnable(draft).valid).toBe(true);
	});
});
