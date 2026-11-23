import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorFrameSkeleton } from "#/components/workflows/editor/workflow-editor-page-skeleton";

describe("EditorFrameSkeleton", () => {
	test("keeps the frame minimal while workflow data loads", () => {
		const html = renderToStaticMarkup(<EditorFrameSkeleton />);

		expect(html).toContain(
			'data-layout-role="workflow-editor-skeleton-header"',
		);
		expect(html).toContain('data-layout-role="workflow-editor-skeleton-name"');
		expect(html).toContain(
			'data-layout-role="workflow-editor-skeleton-spinner"',
		);
		expect(html).not.toContain("workflow-editor-skeleton-toolbox");
		expect(html).not.toContain("workflow-editor-skeleton-node");
		expect(html).not.toContain("workflow-editor-skeleton-toolbar");
		expect(html).not.toContain("workflow-editor-skeleton-mobile-dock");
	});
});
