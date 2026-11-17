import { describe, expect, test } from "bun:test";
import { fitViewOptions } from "#/components/workflows/editor/canvas-zoom";
import {
	focusWorkflowNode,
	mobileToolboxIsOpen,
	sidebarLayoutKey,
} from "#/components/workflows/editor/editor-sidebar";

describe("workflow editor shell contracts", () => {
	test("pending mobile connections force the toolbox open", () => {
		expect(
			mobileToolboxIsOpen({ desktop: false, pending: true, panel: null }),
		).toBe(true);
		expect(
			mobileToolboxIsOpen({
				desktop: false,
				pending: true,
				panel: "properties",
			}),
		).toBe(true);
		expect(
			mobileToolboxIsOpen({ desktop: true, pending: true, panel: null }),
		).toBe(false);
	});

	test("properties node identity does not alter rail geometry", () => {
		expect(sidebarLayoutKey("open", "rule-one")).toBe(
			sidebarLayoutKey("open", "rule-two"),
		);
		expect(sidebarLayoutKey("open", "rule-one")).toBe(
			sidebarLayoutKey("open", null),
		);
		expect(sidebarLayoutKey("auto", null)).toBe(sidebarLayoutKey("open", null));
		expect(sidebarLayoutKey("closed", "rule-one")).toBe("canvas");
	});

	test("closing properties can return focus to its canvas node", () => {
		let focused = "";
		const nodes = ["trigger", "rule"].map((id) => ({
			dataset: { id },
			focus: () => {
				focused = id;
			},
		}));
		expect(focusWorkflowNode(nodes, "rule")).toBe(true);
		expect(focused).toBe("rule");
		expect(focusWorkflowNode(nodes, "missing")).toBe(false);
	});

	test("every fit action shares rail-aware canvas padding", () => {
		expect(fitViewOptions()).toEqual({
			padding: {
				left: "48px",
				right: "48px",
				top: "64px",
				bottom: "48px",
			},
		});
	});

	test("the stable left rail keeps the canvas inset without shell fillets", async () => {
		const css = await Bun.file(
			"apps/web/src/design-system/layout-contract.css",
		).text();

		expect(css).toContain('[data-layout-role="workflow-sidebar-rail"]');
		expect(css).not.toContain("workflow-shell-fillet");
		expect(css).not.toContain("workflow-toolbox-rail");
		expect(css).not.toContain("workflow-properties-rail");
		expect(css).toContain("border-start-start-radius: 18px");
		expect(css).toContain("border-end-start-radius: 18px");
	});

	test("the Paper toolbar geometry remains anchored to the canvas", async () => {
		const css = await Bun.file(
			"apps/web/src/design-system/layout-contract.css",
		).text();
		const toolbar = css.match(
			/\[data-layout-role="workflow-editor-toolbar"\] \{([\s\S]*?)\n\}/,
		)?.[1];

		expect(toolbar).toContain(
			"inset-block-end: calc(var(--space-3) + var(--space-0-5))",
		);
		expect(toolbar).toContain("block-size: var(--space-10)");
		expect(toolbar).toContain("padding: var(--space-1)");
		expect(toolbar).toContain("border-radius: var(--radius-shell)");
	});

	test("mobile removes the hidden desktop rail seam from the canvas", async () => {
		const css = await Bun.file(
			"apps/web/src/design-system/layout-contract.css",
		).text();
		const mobile = css.match(
			/@media \(max-width: 47\.999rem\) \{([\s\S]*)\n\}/,
		)?.[1];
		const canvas = mobile?.match(
			/\[data-layout-role="workflow-shell-body"\]\[data-rail-open\][\s\S]*?> \[data-layout-role="workflow-canvas-stage"\] \{([\s\S]*?)\n\t\}/,
		)?.[1];

		expect(canvas).toContain("border-inline-start: 0");
		expect(canvas).toContain("border-start-start-radius: 0");
		expect(canvas).toContain("border-end-start-radius: 0");
	});

	test("mobile dock minimum tracks fit a 320px viewport", async () => {
		const css = await Bun.file(
			"apps/web/src/design-system/layout-contract.css",
		).text();
		const viewport = 320;
		const horizontalInset = 32;
		const dockPadding = 16;
		const dockBorder = 2;
		const gaps = 12;
		const segmentedItems = 44 * 2;
		const segmentedGapPaddingAndBorder = 2 + 4 + 2;
		const minimumTracks =
			66 + segmentedItems + segmentedGapPaddingAndBorder + 52 + 44;

		expect(minimumTracks + gaps).toBeLessThanOrEqual(
			viewport - horizontalInset - dockPadding - dockBorder,
		);
		expect(css).toContain("minmax(66px, 140px)");
		expect(css).toContain("minmax(96px, 98px)");
		expect(css).toMatch(/minmax\(\s*52px,\s*70px\s*\)/);
		expect(segmentedItems).toBe(88);
		expect(css).toMatch(
			/\[data-layout-role="workflow-editor-mobile-dock"\][\s\S]*?\[data-slot="segmented-control-item"\]::after\s*\{[\s\S]*?block-size:\s*calc\(var\(--space-1\)\s*\*\s*11\)/,
		);
	});
});
