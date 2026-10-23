import { describe, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	WORKFLOW_TEMPLATES,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import {
	estimateCardHeight,
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

describe("estimateCardHeight", () => {
	const byId = (definition: WorkflowDefinition, id: string) => {
		const node = definition.nodes.find((entry) => entry.id === id);
		if (!node) {
			throw new Error(`missing ${id}`);
		}
		return node;
	};

	test("never undershoots the heights the cards render at", () => {
		const measured: [string, number][] = [
			["trigger", 89],
			["account-age", 110],
			["crypto", 69],
			["honeypot", 122],
			["max-files", 110],
			["english", 110],
			["gate", 69],
			["block", 36],
		];
		for (const [id, height] of measured) {
			const estimate = estimateCardHeight(byId(DEFAULT_WORKFLOW, id));
			expect([id, estimate >= height]).toEqual([id, true]);
			expect([id, estimate - height <= 16]).toEqual([id, true]);
		}
	});

	test("counts the outcome row and wrapped schedule labels", () => {
		const issues = WORKFLOW_TEMPLATES.find(
			(template) => template.id === "close-stale-issues",
		);
		if (!issues) {
			throw new Error("stale issues template missing");
		}
		expect(
			estimateCardHeight(byId(issues.definition, "warn")),
		).toBeGreaterThanOrEqual(173);
		expect(
			estimateCardHeight(byId(issues.definition, "close")),
		).toBeGreaterThanOrEqual(189);
		expect(
			estimateCardHeight({ id: "n", type: "gate", mode: "not" }),
		).toBeGreaterThanOrEqual(69);
	});
});
