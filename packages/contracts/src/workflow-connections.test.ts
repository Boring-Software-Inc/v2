import { describe, expect, test } from "bun:test";
import type { EdgeWhen, WorkflowNode } from "./workflow.ts";
import {
	acceptedPortKinds,
	acceptReason,
	applyPort,
	canAccept,
	connectionIssue,
	edgePort,
	outputPorts,
	portFnCodomain,
	WORKFLOW_CONNECTIONS,
	WORKFLOW_PORT_KIND,
	WORKFLOW_PORT_TONE,
	WORKFLOW_PORTS,
	type WorkflowPort,
	workflowPortSchema,
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
		expect(WORKFLOW_CONNECTIONS.gate.accepts).toEqual(["pass", "fail"]);
	});

	test("trigger feeds rules and actions, never gates", () => {
		expect(allowed(trigger, rule)).toBe(true);
		expect(allowed(trigger, block)).toBe(true);
		expect(allowed(trigger, gate)).toBe(false);
		expect(connectionIssue(trigger, gate, undefined)).toEqual({
			on: "target",
			message: "Gates take results, not events",
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

	test("a gate takes Doesn't pass wherever it takes Passes", () => {
		for (const source of [rule, gate]) {
			expect(allowed(source, gate, "fail")).toBe(true);
			expect(allowed(source, gate)).toBe(true);
		}
	});

	test("moderation decisions continue to rules and actions, not gates", () => {
		expect(allowed(moderation, block, "approve")).toBe(true);
		expect(allowed(moderation, rule, "deny")).toBe(true);
		expect(allowed(moderation, gate, "approve")).toBe(false);
		expect(allowed(moderation, block, undefined)).toBe(false);
	});

	test("nothing enters a trigger and final actions have no outputs", () => {
		expect(connectionIssue(rule, trigger, undefined)?.message).toBe(
			"Triggers take no inputs",
		);
		expect(connectionIssue(block, rule, undefined)).toEqual({
			on: "source",
			message: "only Human review steps have outputs",
		});
	});

	test("ports a node does not have are refused", () => {
		expect(allowed(trigger, rule, "fail")).toBe(false);
		expect(allowed(rule, block, "approve")).toBe(false);
	});
});

describe("port kinds", () => {
	test("each port belongs to one kind and one tone", () => {
		expect(WORKFLOW_PORT_KIND).toEqual({
			event: "event",
			pass: "result",
			fail: "result",
			approve: "decision",
			deny: "decision",
		});
		expect(WORKFLOW_PORT_TONE.event).toBe("neutral");
		expect(WORKFLOW_PORT_TONE.pass).toBe("ok");
		expect(WORKFLOW_PORT_TONE.approve).toBe("ok");
		expect(WORKFLOW_PORT_TONE.fail).toBe("fail");
		expect(WORKFLOW_PORT_TONE.deny).toBe("fail");
	});

	test("accepted kinds per node type", () => {
		expect(acceptedPortKinds("trigger")).toEqual([]);
		expect(acceptedPortKinds("gate")).toEqual(["result"]);
		expect(acceptedPortKinds("rule")).toEqual(["event", "result", "decision"]);
		expect(acceptedPortKinds("action")).toEqual([
			"event",
			"result",
			"decision",
		]);
	});
});

describe("accept reasons", () => {
	const every: WorkflowPort[] = ["event", "pass", "fail", "approve", "deny"];

	test("a reason exists exactly when the port is refused", () => {
		for (const type of ["trigger", "rule", "gate", "action"] as const) {
			for (const port of every) {
				expect(acceptReason(type, port) === null).toBe(canAccept(type, port));
			}
		}
	});

	test("reasons are terse and name what the step takes", () => {
		expect(acceptReason("gate", "event")).toBe(
			"Gates take results, not events",
		);
		expect(acceptReason("gate", "fail")).toBeNull();
		expect(acceptReason("gate", "approve")).toBe(
			"Gates take results, not decisions",
		);
		expect(acceptReason("trigger", "pass")).toBe("Triggers take no inputs");
	});

	test("validation reports the same reason the editor shows", () => {
		expect(connectionIssue(trigger, gate, undefined)?.message).toBe(
			acceptReason("gate", "event") ?? "",
		);
		expect(connectionIssue(moderation, gate, "deny")?.message).toBe(
			acceptReason("gate", "deny") ?? "",
		);
	});
});

describe("port types", () => {
	const every = workflowPortSchema.options;

	test("every port function maps a type to itself", () => {
		for (const port of every) {
			const spec = WORKFLOW_PORTS[port];
			expect(portFnCodomain(spec.fn, spec.type)).toBe(spec.type);
		}
	});

	test("a negated port is accepted exactly where its plain twin is", () => {
		const twins = [
			["pass", "fail"],
			["approve", "deny"],
		] as const;
		for (const type of ["trigger", "rule", "gate", "action"] as const) {
			for (const [plain, negated] of twins) {
				expect(canAccept(type, negated)).toBe(canAccept(type, plain));
			}
		}
	});

	test("events have no negation", () => {
		expect(portFnCodomain("not", "event")).toBeNull();
	});

	test("applyPort flips only negated ports", () => {
		expect(applyPort("pass", "pass")).toBe("pass");
		expect(applyPort("pass", "fail")).toBe("fail");
		expect(applyPort("fail", "pass")).toBe("fail");
		expect(applyPort("fail", "fail")).toBe("pass");
		expect(applyPort("deny", "pass")).toBe("fail");
		expect(applyPort("event", "pass")).toBe("pass");
	});
});
