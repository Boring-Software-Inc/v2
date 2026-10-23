import { describe, expect, test } from "bun:test";
import {
	WORKFLOW_TEMPLATES,
	type WorkflowDefinition,
	workflowLanes,
} from "@tripwire/contracts";
import {
	LANE_SPACING,
	laneDecor,
	laneLayout,
	laneSummary,
	placeUnpositioned,
} from "#/components/workflows/editor/lane-layout";

const stale = WORKFLOW_TEMPLATES.find(
	(template) => template.id === "close-stale-change-requests",
);
if (!stale) {
	throw new Error("stale template missing");
}
const STALE: WorkflowDefinition = {
	...stale.definition,
	id: "stale",
	name: stale.name,
};

const fixedHeight = () => 100;

describe("workflowLanes", () => {
	test("each trigger owns the steps it reaches, in run order", () => {
		expect(workflowLanes(STALE)).toEqual([
			{
				index: 0,
				triggerId: "warn",
				nodeIds: ["warn", "mark-stale", "warn-comment"],
			},
			{
				index: 1,
				triggerId: "close",
				nodeIds: ["close", "close-comment", "close-it"],
			},
			{ index: 2, triggerId: "reset", nodeIds: ["reset", "unmark-stale"] },
		]);
	});

	test("a step two triggers reach belongs to the first", () => {
		const lanes = workflowLanes({
			nodes: [
				{ id: "a", type: "trigger", kinds: ["push"] },
				{ id: "b", type: "trigger", kinds: ["comment.created"] },
				{ id: "x", type: "action", action: "close" },
			],
			edges: [
				{ id: "e1", from: "a", to: "x" },
				{ id: "e2", from: "b", to: "x" },
			],
		});
		expect(lanes.map((lane) => lane.nodeIds)).toEqual([["a", "x"], ["b"]]);
	});
});

describe("laneLayout", () => {
	const layout = laneLayout(STALE, fixedHeight);
	const column = LANE_SPACING.cardWidth + LANE_SPACING.columnGap;

	test("lanes stack top to bottom and never overlap", () => {
		const warn = layout.get("warn");
		const close = layout.get("close");
		const reset = layout.get("reset");
		expect(warn?.y).toBe(LANE_SPACING.head);
		expect((close?.y ?? 0) > (warn?.y ?? 0) + 2 * 100).toBe(true);
		expect((reset?.y ?? 0) > (close?.y ?? 0) + 2 * 100).toBe(true);
	});

	test("actions sit one column right and stack in run order", () => {
		expect(layout.get("mark-stale")).toEqual({
			x: column,
			y: LANE_SPACING.head,
		});
		expect(layout.get("warn-comment")).toEqual({
			x: column,
			y: LANE_SPACING.head + 100 + LANE_SPACING.rowGap,
		});
		expect(layout.get("warn")?.x).toBe(0);
	});

	test("one trigger needs no lane head room", () => {
		const single = laneLayout(
			{
				nodes: [
					{ id: "t", type: "trigger", kinds: ["push"] },
					{ id: "c", type: "action", action: "close" },
				],
				edges: [{ id: "e", from: "t", to: "c" }],
			},
			fixedHeight,
		);
		expect(single.get("t")).toEqual({ x: 0, y: 0 });
		expect(single.get("c")).toEqual({ x: column, y: 0 });
	});

	test("stored positions win over the layout", () => {
		const nodes = [
			{ id: "warn", position: { x: 5, y: 5 } },
			{ id: "mark-stale", position: { x: 0, y: 0 } },
		];
		const placed = placeUnpositioned(nodes, {
			...STALE,
			nodes: STALE.nodes.map((node) =>
				node.id === "warn" ? { ...node, position: { x: 5, y: 5 } } : node,
			),
		});
		expect(placed[0]?.position).toEqual({ x: 5, y: 5 });
		expect(placed[1]?.position).not.toEqual({ x: 0, y: 0 });
	});
});

describe("laneDecor", () => {
	const layout = laneLayout(STALE, fixedHeight);
	const boxes = [...layout].map(([id, at]) => ({
		id,
		x: at.x,
		y: at.y,
		width: LANE_SPACING.cardWidth,
		height: 100,
	}));
	const decor = laneDecor(STALE, boxes);

	test("each lane gets a numbered head with its trigger summary", () => {
		expect(decor.heads.map((head) => `${head.index} ${head.label}`)).toEqual([
			"1 Every day, open change requests inactive 21 days",
			"2 Every day, open change requests inactive 7 days",
			"3 A change request gets new commits, or someone comments",
		]);
	});

	test("a full width rule sits between each pair of lanes", () => {
		expect(decor.rules).toHaveLength(2);
		const [first, second] = decor.rules;
		const warnBottom = Math.max(
			...boxes
				.filter((box) =>
					["warn", "mark-stale", "warn-comment"].includes(box.id),
				)
				.map((box) => box.y + box.height),
		);
		expect((first?.y ?? 0) > warnBottom).toBe(true);
		expect((second?.y ?? 0) > (first?.y ?? 0)).toBe(true);
		expect(first?.width).toBe(second?.width);
	});

	test("one trigger draws no lanes", () => {
		expect(
			laneDecor(
				{ nodes: [{ id: "t", type: "trigger", kinds: ["push"] }], edges: [] },
				[{ id: "t", x: 0, y: 0, width: 224, height: 60 }],
			),
		).toEqual({ heads: [], rules: [] });
	});

	test("an unset event trigger still has a summary", () => {
		expect(laneSummary({ id: "t", type: "trigger", kinds: [] })).toBe(
			"Event not set",
		);
	});
});
