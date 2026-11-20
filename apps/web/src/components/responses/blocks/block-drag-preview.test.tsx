import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockDragPreview } from "#/components/responses/blocks/block-drag-preview";

describe("BlockDragPreview", () => {
	test("uses the editor card anatomy for reordered blocks", () => {
		const html = renderToStaticMarkup(
			<BlockDragPreview source="canvas" type="failed-rules" />,
		);

		expect(html).toContain("Failed rules");
		expect(html).toContain(
			"Lists the rules that did not pass and their fix hints.",
		);
		expect(html).toContain("rounded-tag");
		expect(html).not.toContain("shadow-");
		expect(html).not.toContain("Account age");
	});
});
