import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BuilderSkeleton } from "#/components/responses/responses-page-skeleton";

const layoutCss = readFileSync(
	new URL("../../design-system/layout-contract.css", import.meta.url),
	"utf8",
);

describe("BuilderSkeleton", () => {
	test("keeps the stable editor shape and uses one loader for the dynamic preview", () => {
		const html = renderToStaticMarkup(<BuilderSkeleton />);

		expect(html).toContain('data-layout-role="responses-editor-skeleton"');
		expect(html).toContain('data-layout-role="responses-preview-loader"');
		expect(html).toContain("Loading GitHub response preview");
		expect(html).toContain('data-slot="card"');
		expect(html).not.toContain('data-layout-role="responses-preview-skeleton"');
	});

	test("fills every loading wrapper in the responses inset", () => {
		expect(layoutCss).toMatch(
			/> \[skullet-pane\]\s+> \[skullet-own\]\s+> \[data-layout-role="responses-builder-skeleton"\]/,
		);
		expect(layoutCss).toContain("block-size: 100%;\n\tmin-block-size: 0;");
	});
});
