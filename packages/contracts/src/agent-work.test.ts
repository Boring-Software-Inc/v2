import { describe, expect, test } from "bun:test";
import {
	type AgentPresence,
	agentWorking,
	liveMessageSchema,
	liveNodeTouches,
	mergeTouches,
	releaseTouches,
	touchesFromChangeSet,
	workSettlesIn,
} from "./agent-work.ts";
import type { WorkflowDefinition } from "./workflow.ts";
import { workflowChangeSet } from "./workflow-diff.ts";

const T0 = new Date("2026-10-24T12:00:00.000Z");
const at = (seconds: number) =>
	new Date(T0.getTime() + seconds * 1000).toISOString();
const when = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function presence(overrides: Partial<AgentPresence> = {}): AgentPresence {
	return {
		userId: "u1",
		clientId: "c1",
		name: "Claude Code",
		lastSignalAt: at(0),
		finishedAt: null,
		nodes: [],
		...overrides,
	};
}

const base: WorkflowDefinition = {
	id: "wf",
	name: "Close stale PRs",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["schedule.matched"] },
		{ id: "close", type: "action", action: "close" },
	],
	edges: [{ id: "e1", from: "t", to: "close" }],
};

describe("workflowChangeSet", () => {
	test("a new workflow adds every node and edge", () => {
		expect(workflowChangeSet(null, base)).toEqual({
			renamed: false,
			nodes: { added: ["t", "close"], changed: [], removed: [] },
			edges: { added: ["e1"], removed: [] },
		});
	});

	test("names the added, changed and removed nodes and edges", () => {
		const after: WorkflowDefinition = {
			...base,
			name: "Close old PRs",
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "label", type: "action", action: "label" },
			],
			edges: [{ id: "e2", from: "t", to: "label" }],
		};
		expect(workflowChangeSet(base, after)).toEqual({
			renamed: true,
			nodes: { added: ["label"], changed: ["t"], removed: ["close"] },
			edges: { added: ["e2"], removed: ["e1"] },
		});
	});

	test("moving a node is not a change", () => {
		const moved: WorkflowDefinition = {
			...base,
			nodes: base.nodes.map((node) => ({
				...node,
				position: { x: 400, y: 10 },
			})),
		};
		expect(workflowChangeSet(base, moved)).toEqual({
			renamed: false,
			nodes: { added: [], changed: [], removed: [] },
			edges: { added: [], removed: [] },
		});
	});

	test("an edge that keeps its ends and port but gets a new id is the same edge", () => {
		const renumbered = {
			...base,
			edges: [{ id: "e9", from: "t", to: "close" }],
		};
		expect(workflowChangeSet(base, renumbered).edges).toEqual({
			added: [],
			removed: [],
		});
	});
});

describe("touchesFromChangeSet", () => {
	test("added nodes are writes, changed are edits, removed are deletes", () => {
		const set = workflowChangeSet(base, {
			...base,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "n", type: "gate", mode: "all-of" },
			],
			edges: [],
		});
		expect(touchesFromChangeSet(set, T0)).toEqual([
			{ id: "n", action: "write", at: at(0) },
			{ id: "t", action: "edit", at: at(0) },
			{ id: "close", action: "delete", at: at(0) },
		]);
	});
});

describe("agent presence", () => {
	test("an agent works until 30 seconds after its last signal", () => {
		expect(agentWorking(presence(), when(29))).toBe(true);
		expect(agentWorking(presence(), when(30))).toBe(false);
	});

	test("a finished agent is not working", () => {
		expect(agentWorking(presence({ finishedAt: at(1) }), when(2))).toBe(false);
	});

	test("a node clears 12 seconds after its last touch", () => {
		const work = {
			agents: [
				presence({
					lastSignalAt: at(10),
					nodes: [
						{ id: "a", action: "write", at: at(0) },
						{ id: "b", action: "edit", at: at(10) },
					],
				}),
			],
		};
		expect([...liveNodeTouches(work, when(11)).keys()]).toEqual(["a", "b"]);
		expect([...liveNodeTouches(work, when(12)).keys()]).toEqual(["b"]);
		expect([...liveNodeTouches(work, when(22)).keys()]).toEqual([]);
	});

	test("the newest touch on a node wins across agents", () => {
		const work = {
			agents: [
				presence({ nodes: [{ id: "a", action: "read", at: at(0) }] }),
				presence({
					clientId: "c2",
					name: "Cursor",
					lastSignalAt: at(5),
					nodes: [{ id: "a", action: "edit", at: at(5) }],
				}),
			],
		};
		expect(liveNodeTouches(work, when(6)).get("a")).toEqual({
			id: "a",
			action: "edit",
			at: at(5),
			agent: "Cursor",
		});
	});

	test("settles at the next node or session deadline", () => {
		const work = {
			agents: [
				presence({
					lastSignalAt: at(10),
					nodes: [{ id: "a", action: "write", at: at(10) }],
				}),
			],
		};
		expect(workSettlesIn(work, when(15))).toBe(7_000);
		expect(workSettlesIn(work, when(25))).toBe(15_000);
		expect(workSettlesIn(work, when(40))).toBeNull();
	});
});

describe("touch lists", () => {
	test("merging drops stale touches and moves a retouched node to the end", () => {
		const held = [
			{ id: "old", action: "write" as const, at: at(0) },
			{ id: "a", action: "write" as const, at: at(40) },
			{ id: "b", action: "write" as const, at: at(41) },
		];
		expect(
			mergeTouches(held, [{ id: "a", action: "edit", at: at(45) }], when(45)),
		).toEqual([
			{ id: "b", action: "write", at: at(41) },
			{ id: "a", action: "edit", at: at(45) },
		]);
	});

	test("release with ids frees those nodes, with none frees every node", () => {
		const held = [
			{ id: "a", action: "write" as const, at: at(0) },
			{ id: "b", action: "write" as const, at: at(0) },
		];
		expect(releaseTouches(held, ["a"])).toEqual([
			{ id: "b", action: "write", at: at(0) },
		]);
		expect(releaseTouches(held, undefined)).toEqual([]);
	});
});

describe("live message", () => {
	test("a setup message carries the run view", () => {
		const parsed = liveMessageSchema.safeParse({
			type: "setup",
			orgId: "o1",
			run: {
				code: "AbCdE12345",
				stages: {},
				completedAt: null,
				lastReportAt: null,
			},
		});
		expect(parsed.success).toBe(true);
	});
});
