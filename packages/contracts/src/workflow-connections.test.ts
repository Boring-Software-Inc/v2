import { describe, expect, test } from "bun:test";
import type { EdgeWhen, WorkflowNode } from "./workflow.ts";
import {
	connectionIssue,
	edgePort,
	outputPorts,
	WORKFLOW_CONNECTIONS,
} from "./workflow-connections.ts";

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
const moderation: WorkflowNode = {
	id: "m",
	type: "action",
	action: "send-to-moderation",
};

const allowed = (
	source: WorkflowNode,
	target: WorkflowNode,
	when?: EdgeWhen,
): boolean => connectionIssue(source, target, when) === null;

describe("connection matrix", () => {
	test("output ports per node kind", () => {
		expect(outputPorts(trigger)).toEqual(["event"]);
		expect(outputPorts(rule)).toEqual(["pass", "fail"]);
		expect(outputPorts(gate)).toEqual(["pass", "fail"]);
		expect(outputPorts(moderation)).toEqual(["approve", "deny"]);
		expect(outputPorts(block)).toEqual([]);
	});

	test("edge port reads the trigger default as its event", () => {
		expect(edgePort(trigger, undefined)).toBe("event");
		expect(edgePort(rule, undefined)).toBe("pass");
		expect(edgePort(rule, "fail")).toBe("fail");
		expect(edgePort(moderation, "deny")).toBe("deny");
	});

	test("triggers accept nothing; gates accept only results", () => {
		expect(WORKFLOW_CONNECTIONS.trigger.accepts).toEqual([]);
		expect(WORKFLOW_CONNECTIONS.gate.accepts).toEqual(["pass"]);
	});

	test("trigger feeds rules and actions, never gates", () => {
		expect(allowed(trigger, rule)).toBe(true);
		expect(allowed(trigger, block)).toBe(true);
		expect(allowed(trigger, gate)).toBe(false);
		expect(connectionIssue(trigger, gate, undefined)).toEqual({
			on: "target",
			message:
				"a gate combines rule results, not trigger events. Connect the trigger to a rule first",
		});
	});

	test("rule and gate results branch to any step", () => {
		for (const source of [rule, gate]) {
			for (const when of [undefined, "fail"] as const) {
				expect(allowed(source, rule, when)).toBe(true);
				expect(allowed(source, block, when)).toBe(true);
			}
			expect(allowed(source, gate)).toBe(true);
		}
	});

	test("a gate takes the passes output only", () => {
		expect(allowed(rule, gate, "fail")).toBe(false);
		expect(connectionIssue(rule, gate, "fail")?.on).toBe("target");
	});

	test("moderation decisions continue to rules and actions, not gates", () => {
		expect(allowed(moderation, block, "approve")).toBe(true);
		expect(allowed(moderation, rule, "deny")).toBe(true);
		expect(allowed(moderation, gate, "approve")).toBe(false);
		expect(allowed(moderation, block, undefined)).toBe(false);
	});

	test("nothing enters a trigger and final actions have no outputs", () => {
		expect(connectionIssue(rule, trigger, undefined)?.message).toBe(
			"trigger cannot have inputs",
		);
		expect(connectionIssue(block, rule, undefined)).toEqual({
			on: "source",
			message: "only send-to-moderation actions may have outputs",
		});
	});

	test("ports a node does not have are refused", () => {
		expect(allowed(trigger, rule, "fail")).toBe(false);
		expect(allowed(rule, block, "approve")).toBe(false);
	});
});
