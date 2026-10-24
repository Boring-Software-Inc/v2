import { describe, expect, test } from "bun:test";
import {
	decorateLive,
	freshOnMount,
	settleLive,
} from "#/components/workflows/editor/agent-canvas";

interface Piece {
	id: string;
	className?: string;
	style?: Record<string, string>;
}

interface Link extends Piece {
	source: string;
	target: string;
}

const node = (id: string): Piece => ({ id });
const edge = (source: string, target: string): Link => ({
	id: `${source}${target}`,
	source,
	target,
});

const change = {
	renamed: false,
	nodes: { added: ["b", "c"], changed: ["a"], removed: ["x"] },
	edges: { added: ["ab", "bc"], removed: ["ax"] },
};

describe("decorateLive", () => {
	const decorated = decorateLive({
		previous: { nodes: [node("a"), node("x")], edges: [edge("a", "x")] },
		next: {
			nodes: [node("a"), node("b"), node("c")],
			edges: [edge("a", "b"), edge("b", "c")],
		},
		change,
		revision: 3,
	});
	const nodeOf = (id: string) => decorated.nodes.find((n) => n.id === id);
	const edgeOf = (id: string) => decorated.edges.find((e) => e.id === id);

	test("new nodes land in 340 ms, 60 ms apart in the order they arrive", () => {
		expect(nodeOf("b")?.className).toBe("agent-enter");
		expect(nodeOf("b")?.style).toEqual({
			"--agent-delay": "0ms",
			"--agent-duration": "340ms",
		});
		expect(nodeOf("c")?.style).toEqual({
			"--agent-delay": "60ms",
			"--agent-duration": "340ms",
		});
		expect([...decorated.entering]).toEqual([
			["b", 0],
			["c", 60],
		]);
	});

	test("a new edge draws in for 140 ms once both of its ends have landed", () => {
		expect(edgeOf("ab")?.className).toBe("agent-trail");
		expect(edgeOf("ab")?.style).toEqual({
			"--agent-delay": "340ms",
			"--agent-duration": "140ms",
		});
		expect(edgeOf("bc")?.style).toEqual({
			"--agent-delay": "400ms",
			"--agent-duration": "140ms",
		});
	});

	test("a new edge between nodes already on the canvas draws at once", () => {
		const linked = decorateLive({
			previous: { nodes: [node("a"), node("b")], edges: [] },
			next: { nodes: [node("a"), node("b")], edges: [edge("a", "b")] },
			change: {
				renamed: false,
				nodes: { added: [], changed: [], removed: [] },
				edges: { added: ["ab"], removed: [] },
			},
			revision: 1,
		});
		expect(linked.edges[0]?.style).toEqual({
			"--agent-delay": "0ms",
			"--agent-duration": "140ms",
		});
		expect(linked.settleMs).toBe(140);
	});

	test("a changed node pulses, alternating so each revision replays", () => {
		expect(nodeOf("a")?.className).toBe("agent-pulse-b");
		const again = decorateLive({
			previous: { nodes: [node("a")], edges: [] },
			next: { nodes: [node("a")], edges: [] },
			change: { ...change, nodes: { added: [], changed: ["a"], removed: [] } },
			revision: 4,
		});
		expect(again.nodes[0]?.className).toBe("agent-pulse-a");
	});

	test("removed nodes and edges stay as ghosts for a 200 ms fade out", () => {
		const x = nodeOf("x");
		expect(x?.className).toBe("agent-leave");
		expect(x?.style).toEqual({
			"--agent-delay": "0ms",
			"--agent-duration": "200ms",
		});
		expect(x).toMatchObject({ selectable: false, deletable: false });
		expect(edgeOf("ax")?.className).toBe("agent-trail-out");
	});

	test("settles once the last motion ends", () => {
		expect(decorated.settleMs).toBe(1000);
		const built = decorateLive({
			previous: { nodes: [], edges: [] },
			next: {
				nodes: [node("b"), node("c")],
				edges: [edge("b", "c")],
			},
			change: {
				renamed: false,
				nodes: { added: ["b", "c"], changed: [], removed: [] },
				edges: { added: ["bc"], removed: [] },
			},
			revision: 1,
		});
		expect(built.settleMs).toBe(540);
	});

	test("with no change set the next graph shows as it is, with nothing to settle", () => {
		const plain = decorateLive({
			previous: { nodes: [], edges: [] },
			next: { nodes: [node("a")], edges: [] },
			change: null,
			revision: 1,
		});
		expect(plain.nodes).toEqual([node("a")]);
		expect(plain.settleMs).toBe(0);
		expect(plain.entering.size).toBe(0);
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

describe("freshOnMount", () => {
	const now = new Date("2026-10-24T12:00:10.000Z");
	test("a change from the last two seconds still animates when the canvas mounts", () => {
		expect(freshOnMount("2026-10-24T12:00:09.000Z", now)).toBe(true);
		expect(freshOnMount("2026-10-24T12:00:10.500Z", now)).toBe(true);
	});

	test("an older change, or none, shows still", () => {
		expect(freshOnMount("2026-10-24T12:00:07.000Z", now)).toBe(false);
		expect(freshOnMount(null, now)).toBe(false);
	});
});
