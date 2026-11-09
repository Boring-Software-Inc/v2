import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowCode } from "#/components/workflows/editor/workflow-code";

const code = "export const workflow = {};";
const saved = "export const workflow = { enabled: false };";

test("workflow code selects a diff only for an unsaved view with saved code", () => {
	for (const unsaved of [false, true]) {
		for (const before of [null, saved]) {
			const html = renderToStaticMarkup(
				<WorkflowCode
					unsaved={unsaved}
					view={{ kind: "code", code, saved: before, warnings: [], unsaved }}
				/>,
			);
			const slot = unsaved && before !== null ? "diff" : "file";
			expect(html).toContain(`data-slot="tripwire-code-${slot}"`);
			expect(html).toContain("tripwire.ts");
			expect(html).not.toContain('data-layout-role="workflow-code-warnings"');
		}
	}
});

test("workflow code warnings and refusal preserve escaped draft content", () => {
	const hostile = "<b>unfinished</b> مرحبا";
	const html = renderToStaticMarkup(
		<WorkflowCode
			unsaved
			view={{ kind: "code", code, saved, warnings: [hostile], unsaved: true }}
		/>,
	);
	expect(html).toContain('data-layout-role="workflow-code-warnings"');
	expect(html).toContain("&lt;b&gt;unfinished&lt;/b&gt; مرحبا");
	const refused = renderToStaticMarkup(
		<WorkflowCode unsaved view={{ kind: "refused", reason: hostile }} />,
	);
	expect(refused).toContain("This workflow cannot be written as code");
	expect(refused).toContain("&lt;b&gt;unfinished&lt;/b&gt; مرحبا");
	expect(refused).not.toContain('data-slot="tripwire-code-file"');
	expect(refused).not.toContain('data-slot="tripwire-code-diff"');
});
