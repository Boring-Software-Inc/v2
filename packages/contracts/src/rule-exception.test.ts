import { describe, expect, test } from "bun:test";
import {
	EXCEPTION_DRAFT_IDS,
	exceptionDraft,
	exceptionName,
	exceptionRuleNodeIds,
	ruleExceptionNames,
	UNLESS_DECISION_WORDS,
	unlessDecision,
} from "./rule-exception.ts";
import type { WorkflowDefinition } from "./workflow.ts";
import { workflowDefinitionSchema } from "./workflow.ts";
import { workflowToCode } from "./workflow-codegen.ts";
import {
	EMPTY_EXCEPTION_GROUP,
	insertStep,
	lintWorkflow,
	UNLESS_EMPTY_PORT,
} from "./workflow-lint.ts";

const NAMES = new Map([
	["custom-target-main@1", "Target is main"],
	["custom-target-release@1", "Target is release"],
	["custom-release-source@1", "Source starts with release-please"],
	["custom-release-author@1", "Author is the release account"],
]);
const nameOf = (ref: string) => NAMES.get(ref) ?? ref;

function draft(): WorkflowDefinition {
	return exceptionDraft({
		id: "wf",
		name: "Target is main",
		rule: {
			ref: "custom-target-main@1",
			config: {},
			outcome: {
				outcome: "request_fix",
				instruction: "Change the target to main.",
			},
		},
	});
}

function withException(definition: WorkflowDefinition): WorkflowDefinition {
	const refs = [
		"custom-target-release@1",
		"custom-release-source@1",
		"custom-release-author@1",
	];
	return {
		...definition,
		nodes: [
			...definition.nodes,
			...refs.map((ref, index) => ({
				id: `x${index}`,
				type: "rule" as const,
				ref,
				config: {},
			})),
		],
		edges: [
			...definition.edges,
			...refs.flatMap((_, index) => [
				{
					id: `tx${index}`,
					from: EXCEPTION_DRAFT_IDS.trigger,
					to: `x${index}`,
				},
				{
					id: `xg${index}`,
					from: `x${index}`,
					to: EXCEPTION_DRAFT_IDS.exception,
				},
			]),
		],
	};
}

describe("the exception draft", () => {
	test("wires the rule into Requirement, an empty group into Exception, and the outcome on fail", () => {
		const definition = draft();
		expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);
		expect(definition.edges).toContainEqual({
			id: "requirement-gate",
			from: "requirement",
			to: "except-when",
			input: "requirement",
		});
		expect(definition.edges).toContainEqual({
			id: "exception-gate",
			from: "exception",
			to: "except-when",
			input: "exception",
		});
		expect(definition.nodes).toContainEqual({
			id: "outcome",
			type: "action",
			action: "request-fix",
			params: { message: "Change the target to main." },
		});
	});

	test("every outcome becomes its workflow action", () => {
		const action = (outcome: "block" | "human_review" | "note" | "close") =>
			exceptionDraft({
				id: "wf",
				name: "n",
				rule: {
					ref: "account-age@1",
					config: { minDays: 7 },
					outcome: { outcome, instruction: "" },
				},
			}).nodes.find((node) => node.id === "outcome");
		expect(action("block")).toMatchObject({ action: "block" });
		expect(action("human_review")).toMatchObject({
			action: "send-to-moderation",
		});
		expect(action("note")).toMatchObject({ action: "note" });
		expect(action("close")).toMatchObject({ action: "close" });
	});

	test("an empty exception group cannot be turned on", () => {
		const issues = lintWorkflow(draft());
		expect(issues.some((issue) => issue.severity === "error")).toBe(true);
		expect(
			issues
				.filter((issue) => issue.nodeId === EXCEPTION_DRAFT_IDS.exception)
				.map((issue) => [issue.message, issue.fixes]),
		).toEqual([[EMPTY_EXCEPTION_GROUP, []]]);
	});

	test("the filled draft lints clean and prints as unless in code", () => {
		const filled = withException(draft());
		expect(
			lintWorkflow(filled).filter(
				(issue) => issue.severity === "error" && issue.rule !== "unknown-rule",
			),
		).toEqual([]);
		const printed = workflowToCode(filled, { key: "target" });
		expect(printed.ok).toBe(true);
		const code = printed.ok ? printed.code : "";
		expect(code).toContain("unless(");
		expect(code).toContain("Change the target to main.");
	});
});

describe("exception names", () => {
	test("an empty group has no name", () => {
		expect(exceptionName(draft(), EXCEPTION_DRAFT_IDS.gate, nameOf)).toBeNull();
	});

	test("a group names its rules", () => {
		expect(
			exceptionName(withException(draft()), EXCEPTION_DRAFT_IDS.gate, nameOf),
		).toBe(
			"Target is release, Source starts with release-please, Author is the release account",
		);
	});

	test("a rule reads the exceptions scoped to it, and only those", () => {
		const filled = withException(draft());
		expect(ruleExceptionNames(filled, "custom-target-main", nameOf)).toEqual([
			"Target is release, Source starts with release-please, Author is the release account",
		]);
		expect(ruleExceptionNames(filled, "custom-target-release", nameOf)).toEqual(
			[],
		);
	});

	test("exception rules are the group's leaves", () => {
		expect([...exceptionRuleNodeIds(withException(draft()))].sort()).toEqual([
			"x0",
			"x1",
			"x2",
		]);
	});
});

describe("which input decided", () => {
	test("each gate output reads as one decision", () => {
		expect(
			unlessDecision({
				requirement: "pass",
				exception: "fail",
				exceptionApplied: false,
			}),
		).toBe("requirement");
		expect(
			unlessDecision({
				requirement: "fail",
				exception: "pass",
				exceptionApplied: true,
			}),
		).toBe("exception");
		expect(
			unlessDecision({
				requirement: "fail",
				exception: "fail",
				exceptionApplied: false,
			}),
		).toBe("not-applied");
		expect(
			unlessDecision({
				requirement: "fail",
				exception: "skipped",
				exceptionApplied: false,
			}),
		).toBe("unchecked");
		expect(unlessDecision(null)).toBeNull();
		expect(UNLESS_DECISION_WORDS.exception).toBe("Exception applied");
	});
});

describe("Except when lint", () => {
	test("an empty port says which one", () => {
		const definition = draft();
		const noException = {
			...definition,
			edges: definition.edges.filter((edge) => edge.id !== "exception-gate"),
		};
		const noRequirement = {
			...definition,
			edges: definition.edges.filter((edge) => edge.id !== "requirement-gate"),
		};
		const messages = (def: WorkflowDefinition) =>
			lintWorkflow(def)
				.filter((issue) => issue.rule === "unless-inputs")
				.map((issue) => issue.message);
		expect(messages(noException)).toEqual([UNLESS_EMPTY_PORT.exception]);
		expect(messages(noRequirement)).toEqual([UNLESS_EMPTY_PORT.requirement]);
	});

	test("a second requirement can be removed in one fix", () => {
		const definition = withException(draft());
		const doubled = {
			...definition,
			edges: [
				...definition.edges,
				{
					id: "dup",
					from: "x0",
					to: "except-when",
					input: "requirement" as const,
				},
			],
		};
		const issue = lintWorkflow(doubled).find(
			(entry) => entry.rule === "unless-inputs",
		);
		expect(issue?.message).toBe("It takes one requirement. Keep one.");
		expect(issue?.fixes).toEqual([
			{
				label: expect.any(String),
				edit: { type: "remove-edge", edgeId: "dup" },
			},
		]);
	});

	test("inserting a step on a Requirement edge keeps the role on the gate side", () => {
		const inserted = insertStep(draft(), "requirement-gate", {
			id: "age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
		});
		const into = inserted.edges.find((edge) => edge.to === "age");
		const out = inserted.edges.find((edge) => edge.from === "age");
		expect(into?.input).toBeUndefined();
		expect(out).toMatchObject({ to: "except-when", input: "requirement" });
	});
});
