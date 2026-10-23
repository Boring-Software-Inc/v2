import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "./workflow.ts";
import { arrangeWorkflow, layoutWorkflow } from "./workflow-layout.ts";
import { WORKFLOW_TEMPLATES } from "./workflow-templates.ts";

const SPACING = {
	cardWidth: 200,
	columnGap: 80,
	rowGap: 20,
	laneGap: 100,
	head: 40,
};
const heightOf = () => 60;

const MESSY: WorkflowDefinition = {
	id: "messy",
	name: "messy",
	version: 1,
	nodes: [
		{
			id: "block",
			type: "action",
			action: "block",
			position: { x: 5, y: 900 },
		},
		{
			id: "age",
			type: "rule",
			ref: "account-age@1",
			config: { minDays: 7 },
			position: { x: 700, y: -40 },
		},
		{
			id: "t",
			type: "trigger",
			kinds: ["change-request.opened"],
			position: { x: 400, y: 400 },
		},
		{ id: "not", type: "gate", mode: "not" },
	],
	edges: [
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "age", to: "not", when: "fail" },
		{ id: "e3", from: "not", to: "block" },
	],
};

describe("arrangeWorkflow", () => {
	test("moves every node to its lane position and changes nothing else", () => {
		const arranged = arrangeWorkflow(MESSY, { spacing: SPACING, heightOf });
		const placed = layoutWorkflow(MESSY, { spacing: SPACING, heightOf });
		expect(arranged.edges).toEqual(MESSY.edges);
		expect(arranged.nodes.map(({ position, ...rest }) => rest)).toEqual(
			MESSY.nodes.map(({ position, ...rest }) => rest),
		);
		expect(arranged.nodes.map((node) => node.position)).toEqual(
			MESSY.nodes.map((node) => placed.get(node.id)),
		);
		expect(arranged.nodes.map((node) => [node.id, node.position])).toEqual([
			["block", { x: 840, y: 0 }],
			["age", { x: 280, y: 0 }],
			["t", { x: 0, y: 0 }],
			["not", { x: 560, y: 0 }],
		]);
	});

	test("arranging an arranged graph is a no-op", () => {
		const once = arrangeWorkflow(MESSY, { spacing: SPACING, heightOf });
		expect(arrangeWorkflow(once, { spacing: SPACING, heightOf })).toEqual(once);
	});

	test("keeps the rest of the definition and leaves the input untouched", () => {
		const before = structuredClone(MESSY);
		const arranged = arrangeWorkflow(MESSY, { spacing: SPACING, heightOf });
		expect(MESSY).toEqual(before);
		expect({ ...arranged, nodes: [] }).toEqual({ ...MESSY, nodes: [] });
	});

	test("every template arranges into lanes without overlapping cards", () => {
		for (const template of WORKFLOW_TEMPLATES) {
			const arranged = arrangeWorkflow(template.definition, {
				spacing: SPACING,
				heightOf,
			});
			const boxes = arranged.nodes.map((node) => node.position);
			for (const [index, a] of boxes.entries()) {
				for (const b of boxes.slice(index + 1)) {
					const apart =
						a === undefined ||
						b === undefined ||
						Math.abs(a.x - b.x) >= SPACING.cardWidth ||
						Math.abs(a.y - b.y) >= heightOf();
					expect(apart).toBe(true);
				}
			}
		}
	});
});
