import { describe, expect, test } from "bun:test";
import {
	AGENT_STAGGER_MS,
	decorateLive,
	settleLive,
} from "#/components/workflows/editor/agent-canvas";

interface Piece {
	id: string;
	className?: string;
	style?: Record<string, string>;
}

const node = (id: string): Piece => ({ id });
const edge = (id: string): Piece => ({ id });

const change = {
	renamed: false,
	nodes: { added: ["b", "c"], changed: ["a"], removed: ["x"] },
	edges: { added: ["ab"], removed: ["ax"] },
};

describe("decorateLive", () => {
	const decorated = decorateLive({
		previous: { nodes: [node("a"), node("x")], edges: [edge("ax")] },
		next: {
			nodes: [node("a"), node("b"), node("c")],
			edges: [edge("ab")],
		},
		change,
		revision: 3,
	});

	test("new nodes fade in one after another", () => {
		const b = decorated.nodes.find((n) => n.id === "b");
		const c = decorated.nodes.find((n) => n.id === "c");
		expect(b?.className).toBe("agent-enter");
		expect(b?.style).toEqual({ "--agent-delay": "0ms" });
		expect(c?.style).toEqual({ "--agent-delay": `${AGENT_STAGGER_MS}ms` });
	});

	test("a changed node pulses, alternating so each revision replays", () => {
		expect(decorated.nodes.find((n) => n.id === "a")?.className).toBe(
			"agent-pulse-b",
		);
		const again = decorateLive({
			previous: { nodes: [node("a")], edges: [] },
			next: { nodes: [node("a")], edges: [] },
			change: { ...change, nodes: { added: [], changed: ["a"], removed: [] } },
			revision: 4,
		});
		expect(again.nodes[0]?.className).toBe("agent-pulse-a");
	});

	test("removed nodes and edges stay as ghosts that fade out", () => {
		const x = decorated.nodes.find((n) => n.id === "x");
		expect(x?.className).toBe("agent-leave");
		expect(x).toMatchObject({ selectable: false, deletable: false });
		expect(decorated.edges.find((e) => e.id === "ax")?.className).toBe(
			"agent-trail-out",
		);
	});

	test("new edges draw in as a trail", () => {
		expect(decorated.edges.find((e) => e.id === "ab")?.className).toBe(
			"agent-trail",
		);
	});

	test("with no change set the next graph shows as it is", () => {
		const plain = decorateLive({
			previous: { nodes: [], edges: [] },
			next: { nodes: [node("a")], edges: [] },
			change: null,
			revision: 1,
		});
		expect(plain.nodes).toEqual([node("a")]);
	});
});

describe("settleLive", () => {
	test("drops ghosts and clears the motion marks", () => {
		const settled = settleLive([
			{ id: "a", className: "agent-enter" },
			{ id: "x", className: "agent-leave" },
			{ id: "y", className: "kept agent-pulse-a" },
			{ id: "z" },
		]);
		expect(settled).toEqual([
			{ id: "a", className: undefined },
			{ id: "y", className: "kept" },
			{ id: "z" },
		]);
	});
});
