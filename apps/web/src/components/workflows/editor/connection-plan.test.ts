import { describe, expect, test } from "bun:test";
import type { WorkflowNode } from "@tripwire/contracts";
import {
	handlePort,
	handleReason,
	inputLook,
	inputSummary,
	NO_OUTPUTS_REASON,
	outputLook,
	planDrag,
	portHandleId,
	SELF_REASON,
} from "#/components/workflows/editor/connection-plan";

const trigger: WorkflowNode = {
	id: "t",
	type: "trigger",
	kinds: ["change-request.opened"],
};
const rule: WorkflowNode = {
	id: "r",
	type: "rule",
	ref: "account-age@1",
	config: {},
};
const gate: WorkflowNode = { id: "g", type: "gate", mode: "all-of" };
const block: WorkflowNode = { id: "b", type: "action", action: "block" };
const nodes = [trigger, rule, gate, block];

describe("port looks", () => {
	test("outputs take their kind's shape and tone", () => {
		expect(outputLook("event")).toEqual({ shape: "event", tone: "neutral" });
		expect(outputLook("fail")).toEqual({ shape: "result", tone: "fail" });
		expect(outputLook("approve")).toEqual({ shape: "decision", tone: "ok" });
	});

	test("inputs take the shape of what they accept", () => {
		expect(inputLook("trigger")).toBeNull();
		expect(inputLook("gate")).toEqual({ shape: "result", tone: "ok" });
		expect(inputLook("rule")).toEqual({ shape: "any", tone: "neutral" });
	});

	test("input summaries name what each step takes", () => {
		expect(inputSummary("gate")).toEqual([
			{ look: { shape: "result", tone: "ok" }, label: "Passes" },
		]);
		expect(inputSummary("rule").map((entry) => entry.label)).toEqual([
			"Events",
			"Results",
			"Decisions",
		]);
		expect(inputSummary("trigger")).toEqual([]);
	});

	test("handle ids round trip through ports", () => {
		expect(portHandleId("pass")).toBeNull();
		expect(portHandleId("deny")).toBe("deny");
		expect(handlePort(trigger, null)).toBe("event");
		expect(handlePort(rule, "fail")).toBe("fail");
	});
});

describe("drag plans", () => {
	test("dragging the trigger event opens rules and actions, not gates", () => {
		const plan = planDrag(
			{ nodeId: "t", handleId: null, handleType: "source" },
			nodes,
		);
		expect(plan?.port).toBe("event");
		expect(plan?.verdicts.get("r")?.reason).toBeNull();
		expect(plan?.verdicts.get("b")?.reason).toBeNull();
		expect(plan?.verdicts.get("g")?.reason).toBe(
			"Gates take results, not events",
		);
		expect(plan?.verdicts.get("t")?.origin).toBe(true);
	});

	test("a rule's Passes output opens the gate", () => {
		const plan = planDrag(
			{ nodeId: "r", handleId: null, handleType: "source" },
			nodes,
		);
		expect(plan?.verdicts.get("g")?.reason).toBeNull();
		expect(plan?.verdicts.get("t")?.reason).toBe("Triggers take no inputs");
		expect(handleReason(plan?.verdicts.get("r"), null)).toBe(SELF_REASON);
	});

	test("reconnecting into a gate opens only Passes outputs", () => {
		const plan = planDrag(
			{ nodeId: "g", handleId: null, handleType: "target" },
			nodes,
		);
		const fromRule = plan?.verdicts.get("r");
		expect(fromRule?.reason).toBeNull();
		expect(handleReason(fromRule, null)).toBeNull();
		expect(handleReason(fromRule, "fail")).toBe(
			"Gates take only the Passes result",
		);
		expect(plan?.verdicts.get("t")?.reason).toBe(
			"Gates take results, not events",
		);
		expect(plan?.verdicts.get("b")?.reason).toBe(NO_OUTPUTS_REASON);
	});

	test("an unknown origin plans nothing", () => {
		expect(
			planDrag({ nodeId: "x", handleId: null, handleType: "source" }, nodes),
		).toBeNull();
	});
});
