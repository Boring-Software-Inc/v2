import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorToolbar } from "#/components/workflows/editor/editor-toolbar";

function toolbar(selected: boolean, view: "canvas" | "code" = "canvas") {
	const selectedNode = selected ? (DEFAULT_WORKFLOW.nodes[0] ?? null) : null;
	return renderToStaticMarkup(
		<EditorToolbar
			blockers={[]}
			customRules={[]}
			definition={DEFAULT_WORKFLOW}
			enabled={true}
			forge="github"
			name="Check contributions"
			onArrange={() => undefined}
			onDuplicateSelected={() => undefined}
			onOpenToolbox={() => undefined}
			onRemoveSelected={() => undefined}
			onSetEnabled={() => undefined}
			onShowProblems={() => undefined}
			onViewChange={() => undefined}
			readOnly={false}
			selectedName={selectedNode ? "Change request opened" : null}
			selectedNode={selectedNode}
			toggling={false}
			view={view}
			zeroNodes={false}
		/>,
	);
}

describe("EditorToolbar", () => {
	test("shows workflow-level controls when no step is selected", () => {
		const html = toolbar(false);
		expect(html).toContain('aria-label="Workflow tools"');
		expect(html).toContain("Canvas");
		expect(html).toContain("Code");
		expect(html).toContain("Copy");
		expect(html).toContain("Auto-arrange");
		expect(html).toContain("Turn off workflow");
	});

	test("keeps the generic toolbar geometry stable across Canvas and Code", () => {
		const canvas = toolbar(false, "canvas");
		const code = toolbar(false, "code");
		const order = ["Canvas", "Code", "Workflow on", "Copy", "Auto-arrange"];

		for (const html of [canvas, code]) {
			expect(html).toContain('data-layout-state="generic"');
			let previous = -1;
			for (const label of order) {
				const at = html.indexOf(label);
				expect(at).toBeGreaterThan(previous);
				previous = at;
			}
		}
		expect(canvas).not.toContain('data-reserved=""');
		expect(code).toContain('data-reserved=""');
		expect(code).toContain('aria-hidden="true"');
		expect(code).toContain('tabindex="-1"');
		expect(code).toContain("disabled");
	});

	test("replaces workflow-level controls with selected-step actions", () => {
		const html = toolbar(true);
		expect(html).toContain('data-layout-state="selected"');
		expect(html).toContain('aria-label="Change request opened actions"');
		expect(html).toContain("Duplicate");
		expect(html).toContain("Remove");
		expect(html).not.toContain('aria-label="Workflow tools"');
		expect(html).not.toContain("Auto-arrange");
		expect(html).not.toContain("Turn off workflow");
	});
});
