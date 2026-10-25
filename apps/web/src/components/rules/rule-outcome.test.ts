import { describe, expect, test } from "bun:test";
import {
	outcomeFooterState,
	outcomeLine,
	outcomeSavedMessage,
	RULE_OUTCOME_ITEMS,
	sameOutcome,
	withInstruction,
	withOutcome,
} from "./rule-outcome";

const standalone = {
	management: "standalone",
	owners: [],
	workflowId: null,
};

describe("rule outcome picker", () => {
	test("offers the five outcomes in the plan's words, Block first", () => {
		expect(RULE_OUTCOME_ITEMS.map((item) => item.label)).toEqual([
			"Block",
			"Ask author to fix",
			"Human review",
			"Note only",
			"Close",
		]);
	});

	test("only fix and note carry an editable line", () => {
		expect(outcomeLine("request_fix")).toEqual({
			label: "Instruction",
			placeholder: "Change the target to main.",
		});
		expect(outcomeLine("note")).toEqual({
			label: "Note",
			placeholder: "No description provided.",
		});
		expect(outcomeLine("block")).toBeNull();
		expect(outcomeLine("human_review")).toBeNull();
		expect(outcomeLine("close")).toBeNull();
	});

	test("switching outcome drops text that belonged to another line", () => {
		const fix = {
			outcome: "request_fix",
			instruction: "Rebase on main.",
		} as const;
		expect(withOutcome(fix, "note")).toEqual({
			outcome: "note",
			instruction: "",
		});
		expect(withOutcome(fix, "block")).toEqual({
			outcome: "block",
			instruction: "",
		});
		expect(withOutcome(fix, "request_fix")).toEqual(fix);
	});

	test("instruction edits are trimmed and compared exactly", () => {
		const fix = { outcome: "request_fix", instruction: "" } as const;
		const edited = withInstruction(fix, "  Change the target to main. ");
		expect(edited.instruction).toBe("Change the target to main.");
		expect(sameOutcome(fix, edited)).toBe(false);
		expect(sameOutcome(edited, { ...edited })).toBe(true);
	});

	test("the undo toast names the rule and what changed", () => {
		const block = { outcome: "block", instruction: "" } as const;
		const fix = { outcome: "request_fix", instruction: "Rebase." } as const;
		expect(outcomeSavedMessage("Target branch", block, fix)).toBe(
			"Target branch: Ask author to fix",
		);
		expect(
			outcomeSavedMessage("Target branch", fix, {
				...fix,
				instruction: "Rebase on main.",
			}),
		).toBe("Target branch: instruction saved");
		expect(
			outcomeSavedMessage(
				"Description",
				{ outcome: "note", instruction: "" },
				{ outcome: "note", instruction: "Empty." },
			),
		).toBe("Description: note saved");
	});
});

describe("outcome footer state", () => {
	test("a standalone rule with no stored outcome reads Block", () => {
		expect(outcomeFooterState(standalone)).toEqual({
			kind: "standalone",
			setting: { outcome: "block", instruction: "" },
			line: null,
		});
	});

	test("a fix outcome shows its instruction line", () => {
		const state = outcomeFooterState({
			...standalone,
			outcome: { outcome: "request_fix", instruction: "Rebase." },
		});
		expect(state.kind === "standalone" && state.line?.label).toBe(
			"Instruction",
		);
	});

	test("a workflow-managed rule shows every owner and no picker", () => {
		const owners = [
			{ id: "wf-1", name: "Release gate" },
			{ id: "wf-2", name: "Safety" },
		];
		expect(
			outcomeFooterState({
				management: "managed",
				owners,
				workflowId: "wf-1",
				outcome: { outcome: "note", instruction: "" },
			}),
		).toEqual({ kind: "managed", owners });
	});

	test("owners alone mark a rule as managed", () => {
		expect(
			outcomeFooterState({
				...standalone,
				owners: [{ id: "wf-1", name: "Release gate" }],
			}).kind,
		).toBe("managed");
	});
});
