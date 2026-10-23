import { describe, expect, test } from "bun:test";
import type { WorkflowNode } from "./workflow.ts";
import {
	handlePort,
	handleReason,
	inputLook,
	inputSummary,
	outputLook,
	planDrag,
	portHandleId,
} from "./workflow-canvas.ts";

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
		expect(outputLook("event")).toEqual({
			shape: "event",
			tone: "neutral",
			negated: false,
		});
		expect(outputLook("fail")).toEqual({
			shape: "result",
			tone: "fail",
			negated: true,
		});
		expect(outputLook("approve")).toEqual({
			shape: "decision",
			tone: "ok",
			negated: false,
		});
	});

	test("inputs take the shape of what they accept", () => {
		expect(inputLook("trigger")).toBeNull();
		expect(inputLook("gate")).toEqual({
			shape: "result",
			tone: "neutral",
			negated: false,
		});
		expect(inputLook("rule")).toEqual({
			shape: "any",
			tone: "neutral",
			negated: false,
		});
	});

	test("input summaries name what each step takes", () => {
		expect(inputSummary("gate")).toEqual([
			{
				look: { shape: "result", tone: "neutral", negated: false },
				label: "Results",
			},
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
		expect(plan?.verdicts.get("g")?.reason).toEqual({
			rule: "gate-input",
			message: "All of takes rule results, not events",
		});
		expect(plan?.verdicts.get("t")?.origin).toBe(true);
	});

	test("a rule's Passes output opens the gate", () => {
		const plan = planDrag(
			{ nodeId: "r", handleId: null, handleType: "source" },
			nodes,
		);
		expect(plan?.verdicts.get("g")?.reason).toBeNull();
		expect(plan?.verdicts.get("t")?.reason).toEqual({
			rule: "trigger-input",
			message: "Trigger takes no inputs",
		});
		expect(handleReason(plan?.verdicts.get("r"), null)).toEqual({
			rule: "cycle",
			message: "Account age cannot connect to itself",
		});
	});

	test("reconnecting into a gate opens both result outputs", () => {
		const plan = planDrag(
			{ nodeId: "g", handleId: null, handleType: "target" },
			nodes,
		);
		const fromRule = plan?.verdicts.get("r");
		expect(fromRule?.reason).toBeNull();
		expect(handleReason(fromRule, null)).toBeNull();
		expect(handleReason(fromRule, "fail")).toBeNull();
		expect(plan?.verdicts.get("t")?.reason?.rule).toBe("gate-input");
		expect(plan?.verdicts.get("b")?.reason).toEqual({
			rule: "no-outputs",
			message: "Block has no outputs",
		});
	});

	test("an unknown origin plans nothing", () => {
		expect(
			planDrag({ nodeId: "x", handleId: null, handleType: "source" }, nodes),
		).toBeNull();
	});
});

describe("drag chip names steps with the caller's names", () => {
	test("custom names reach the hint", () => {
		const plan = planDrag(
			{ nodeId: "t", handleId: null, handleType: "source" },
			nodes,
			(node) => (node.id === "g" ? "Every check" : node.id),
		);
		expect(plan?.verdicts.get("g")?.reason?.message).toBe(
			"Every check takes rule results, not events",
		);
	});
});
