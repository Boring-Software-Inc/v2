import { describe, expect, test } from "bun:test";
import {
	compileWorkflows,
	type WorkflowDefinition,
	workflowAuthoring,
	workflowToCode,
} from "@tripwire/contracts";
import { skipWhenDraft } from "@tripwire/utils";
import {
	addGroupRule,
	addSkipCheck,
	attachSkip,
	connectTrigger,
	deleteCard,
	removeGroupRule,
	removeSkip,
	removeSkipCheck,
	ruleGroupsView,
	setSkipMode,
	skipLabel,
	viewGraph,
} from "#/lib/rule-groups";
import { definitionToGraph, graphToDefinition } from "#/lib/workflow-editor";

const { allOf, block, customCheck, requestFix, unless, workflow, workflows } =
	workflowAuthoring;

function ids() {
	let next = 0;
	return () => {
		next++;
		return `n${next}`;
	};
}

function compiled(spec: Parameters<typeof workflows>[0]): WorkflowDefinition {
	const result = compileWorkflows(workflows(spec));
	if (!result.ok || !result.definitions[0]) {
		throw new Error("did not compile");
	}
	return result.definitions[0];
}

function code(definition: WorkflowDefinition): string {
	const printed = workflowToCode(definition, { key: "target" });
	if (!printed.ok) {
		throw new Error(printed.reason);
	}
	return printed.code.replace(/\s+/g, " ");
}

function expr(definition: WorkflowDefinition, id: string): string {
	const node = definition.nodes.find((entry) => entry.id === id);
	const inputs = definition.edges.filter((edge) => edge.to === id);
	if (node?.type === "rule") {
		const [ruleId = ""] = node.ref.split("@");
		return ruleId.startsWith("custom-")
			? `customCheck("${ruleId}")`
			: `check("${ruleId}")`;
	}
	if (node?.type !== "gate") {
		return node?.type ?? "missing";
	}
	if (node.mode === "unless") {
		const requirement = inputs.find((edge) => edge.input === "requirement");
		const exception = inputs.find((edge) => edge.input === "exception");
		return `unless(${requirement ? expr(definition, requirement.from) : ""}, ${exception ? expr(definition, exception.from) : ""})`;
	}
	const helper = { "all-of": "allOf", "any-of": "anyOf", not: "not" }[
		node.mode
	];
	return `${helper}(${inputs.map((edge) => expr(definition, edge.from)).join(", ")})`;
}

function shape(definition: WorkflowDefinition): string {
	const into = definition.edges.find(
		(edge) =>
			definition.nodes.find((node) => node.id === edge.to)?.type === "action",
	);
	const action = definition.nodes.find((node) => node.id === into?.to);
	return `${into ? expr(definition, into.from) : ""}.${into?.when ?? "pass"} -> ${action?.type === "action" ? action.action : ""}`;
}

function roundTrip(definition: WorkflowDefinition): WorkflowDefinition {
	const graph = definitionToGraph(definition);
	const back = graphToDefinition(
		{ id: definition.id, name: definition.name, version: definition.version },
		graph.nodes,
		graph.edges,
	);
	if (!back.ok) {
		throw new Error(back.error);
	}
	return {
		...back.definition,
		nodes: back.definition.nodes.map(({ position: _p, ...node }) => node),
	};
}

const PLAIN: WorkflowDefinition = {
	id: "wf",
	name: "Crypto",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "crypto", type: "rule", ref: "crypto-address@1", config: {} },
		{ id: "stop", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "t", to: "crypto" },
		{ id: "e2", from: "crypto", to: "stop", when: "fail" },
	],
};

const MAIN = { ref: "custom-target-main@1", config: {} };
const RELEASE = { ref: "custom-target-release@1", config: {} };
const SOURCE = { ref: "custom-release-source@1", config: {} };

describe("a group with no gate", () => {
	test("one rule reads as a group of one and prints as a plain check", () => {
		const view = ruleGroupsView(PLAIN);
		expect(view.cards.get("crypto")).toMatchObject({
			kind: "group",
			ruleIds: ["crypto"],
			skipId: null,
		});
		expect(shape(PLAIN)).toBe('check("crypto-address").fail -> block');
		expect(code(PLAIN)).toContain("block().after(crypto.fails)");
		expect(roundTrip(PLAIN)).toEqual(PLAIN);
	});

	test("several rules become all of the group's rules and back to one", () => {
		const id = ids();
		const two = addGroupRule(PLAIN, "crypto", MAIN, id);
		const view = ruleGroupsView(two);
		const [card] = [...view.cards.values()];
		expect(card).toMatchObject({ kind: "group", ruleIds: ["crypto", "n1"] });
		expect(shape(two)).toBe(
			'allOf(check("crypto-address"), customCheck("custom-target-main")).fail -> block',
		);
		expect(roundTrip(two)).toEqual(two);
		const gateId = card?.id ?? "";
		const back = removeGroupRule(two, gateId, "n1");
		expect(back.nodes.map((node) => node.id).sort()).toEqual(
			["crypto", "stop", "t"].sort(),
		);
		expect(back.edges).toContainEqual({
			id: "e2",
			from: "crypto",
			to: "stop",
			when: "fail",
		});
	});
});

describe("Skip when compiles to unless", () => {
	test("one rule: Skip when X then the group compiles to unless(a, X)", () => {
		const id = ids();
		const attached = attachSkip(PLAIN, "crypto", id);
		if (!attached) {
			throw new Error("no skip");
		}
		const withCheck = addSkipCheck(
			attached.graph,
			attached.skipId,
			RELEASE,
			id,
		);
		expect(shape(withCheck)).toBe(
			'unless(check("crypto-address"), allOf(customCheck("custom-target-release"))).fail -> block',
		);
		expect(code(withCheck)).toContain("unless(crypto, ");
		expect(roundTrip(withCheck)).toEqual(withCheck);
	});

	test("several rules: Skip when X then group[a, b] compiles to unless(allOf(a, b), X)", () => {
		const id = ids();
		const attached = attachSkip(PLAIN, "crypto", id);
		if (!attached) {
			throw new Error("no skip");
		}
		const view = ruleGroupsView(attached.graph);
		const groupId = [...view.cards.values()].find(
			(card) => card.kind === "group",
		)?.id;
		const two = addGroupRule(attached.graph, groupId ?? "", MAIN, id);
		const checks = addSkipCheck(
			addSkipCheck(two, attached.skipId, RELEASE, id),
			attached.skipId,
			SOURCE,
			id,
		);
		expect(shape(checks)).toBe(
			'unless(allOf(check("crypto-address"), customCheck("custom-target-main")), allOf(customCheck("custom-target-release"), customCheck("custom-release-source"))).fail -> block',
		);
		const anyOf = setSkipMode(checks, attached.skipId, "any-of");
		expect(shape(anyOf)).toContain(
			'anyOf(customCheck("custom-target-release"), customCheck("custom-release-source"))',
		);
		expect(code(anyOf)).toContain("anyOf(");
		expect(roundTrip(anyOf)).toEqual(anyOf);
	});

	test("removing the skip puts the outcome back on the group", () => {
		const id = ids();
		const attached = attachSkip(PLAIN, "crypto", id);
		if (!attached) {
			throw new Error("no skip");
		}
		const back = removeSkip(
			addSkipCheck(attached.graph, attached.skipId, RELEASE, id),
			attached.skipId,
		);
		expect(shape(back)).toEqual(shape(PLAIN));
	});
});

describe("tripwire.ts unless loads as Skip when and a group", () => {
	const on = workflowAuthoring.trigger(
		"change-request.opened",
		"change-request.updated",
	);

	test("one rule", () => {
		const definition = compiled({
			target: workflow({
				on,
				check: unless(
					customCheck("custom-target-main"),
					allOf(
						customCheck("custom-target-release"),
						customCheck("custom-release-source"),
						customCheck("custom-release-author"),
					),
				),
				fail: [requestFix({ message: "Change the target to main." })],
			}),
		});
		const view = ruleGroupsView(definition);
		const group = [...view.cards.values()].find(
			(card) => card.kind === "group",
		);
		const skip = [...view.cards.values()].find((card) => card.kind === "skip");
		expect(group?.kind === "group" && group.ruleIds.length).toBe(1);
		expect(skip?.kind === "skip" && skip.checkIds.length).toBe(3);
		expect(skip?.kind === "skip" && skip.mode).toBe("all-of");
		const visible = viewGraph(definition);
		expect(visible.nodes.map((node): string => node.type).sort()).toEqual(
			["action", "gate", "gate", "trigger"].sort(),
		);
		expect(roundTrip(definition)).toEqual(definition);
	});

	test("several rules", () => {
		const definition = compiled({
			target: workflow({
				on,
				check: unless(
					allOf(customCheck("custom-a"), customCheck("custom-b")),
					customCheck("custom-x"),
				),
				fail: [block()],
			}),
		});
		const view = ruleGroupsView(definition);
		const group = [...view.cards.values()].find(
			(card) => card.kind === "group",
		);
		const skip = [...view.cards.values()].find((card) => card.kind === "skip");
		expect(group?.kind === "group" && group.ruleIds.length).toBe(2);
		expect(skip?.kind === "skip" && skip.checkIds).toEqual([skip?.id ?? ""]);
		expect(roundTrip(definition)).toEqual(definition);
		const id = ids();
		const added = addSkipCheck(definition, skip?.id ?? "", RELEASE, id);
		expect(shape(added)).toBe(
			'unless(allOf(customCheck("custom-a"), customCheck("custom-b")), allOf(customCheck("custom-x"), customCheck("custom-target-release"))).fail -> block',
		);
		const removed = removeSkipCheck(
			definition,
			skip?.id ?? "",
			skip?.id ?? "",
			id,
		);
		const after = ruleGroupsView(removed);
		const empty = [...after.cards.values()].find(
			(card) => card.kind === "skip",
		);
		expect(empty?.kind === "skip" && empty.checkIds).toEqual([]);
	});

	test("a group with no gate", () => {
		const definition = compiled({
			crypto: workflow({
				on,
				check: workflowAuthoring.check("crypto-address"),
				fail: [block()],
			}),
		});
		const [card] = [...ruleGroupsView(definition).cards.values()];
		expect(card).toMatchObject({ kind: "group", skipId: null });
		expect(roundTrip(definition)).toEqual(definition);
	});
});

describe("an empty Skip when", () => {
	const draft = skipWhenDraft({
		id: "wf",
		name: "Target is main",
		ref: "custom-target-main@1",
		config: {},
	});

	test("reads as an empty Skip when before a group of that rule", () => {
		const view = ruleGroupsView(draft);
		expect(view.cards.get("except-when")).toMatchObject({
			kind: "group",
			ruleIds: ["requirement"],
			skipId: "exception",
		});
		expect(view.cards.get("exception")).toMatchObject({
			kind: "skip",
			checkIds: [],
		});
		expect(view.viewEdges.map((edge) => [edge.from, edge.to])).toEqual([
			["trigger", "exception"],
		]);
	});

	test("deleting the group deletes its skip and rules", () => {
		const gone = deleteCard(draft, "except-when");
		expect(gone.nodes.map((node) => node.id).sort()).toEqual(
			["outcome", "trigger"].sort(),
		);
	});

	test("a trigger connected to the skip runs every rule and check", () => {
		const id = ids();
		const withCheck = addSkipCheck(draft, "exception", RELEASE, id);
		const second: WorkflowDefinition = {
			...withCheck,
			nodes: [
				...withCheck.nodes,
				{ id: "t2", type: "trigger", kinds: ["change-request.closed"] },
			],
		};
		const wired = connectTrigger(second, "t2", "exception", id);
		const fromT2 = wired.edges.filter((edge) => edge.from === "t2");
		expect(fromT2.map((edge) => edge.to).sort()).toEqual(
			["n1", "requirement"].sort(),
		);
	});
});

describe("skip labels", () => {
	test("read as a list joined by the mode", () => {
		expect(skipLabel(["A"], "all-of")).toBe("A");
		expect(skipLabel(["A", "B", "C"], "all-of")).toBe("A, B and C");
		expect(skipLabel(["A", "B"], "any-of")).toBe("A or B");
	});
});
