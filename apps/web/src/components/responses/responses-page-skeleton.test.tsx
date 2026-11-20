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
		expect(html).toContain("Loading response preview");
		expect(html).not.toContain("GitHub");
		expect(html).toContain('data-slot="card"');
		expect(html).not.toContain('data-layout-role="responses-preview-skeleton"');
	});

	for (const [forge, name] of [
		["github", "GitHub"],
		["gitcafe", "GitCafe"],
	] as const) {
		test(`names ${name} only after its repository context is resolved`, () => {
			expect(renderToStaticMarkup(<BuilderSkeleton forge={forge} />)).toContain(
				`Loading ${name} response preview`,
			);
		});
	}

	test("fills every loading wrapper in the responses inset", () => {
		expect(layoutCss).toMatch(
			/> \[skullet-pane\]\s+> \[skullet-own\]\s+> \[data-layout-role="responses-builder-skeleton"\]/,
		);
		expect(layoutCss).toContain("block-size: 100%;\n\tmin-block-size: 0;");
	});

	test("does not reserve an empty desktop column beside the builder", () => {
		expect(layoutCss).not.toContain(
			"grid-template-columns: minmax(0, 1fr) calc(var(--space-1) * 80);",
		);
	});

	test("constrains the desktop workspace so its columns keep their own scroll", () => {
		expect(layoutCss).toMatch(
			/\[data-layout-role="responses-shell"\] \[data-slot="skeleton-swap"\],\s+\[data-layout-role="responses-shell"\] \[data-slot="skeleton-swap"\] > \*,\s+\[data-layout-role="response-workspace"\] \{\s+block-size: 100%;/,
		);
		expect(layoutCss).toMatch(
			/\[data-layout-role="responses-shell"\] \{\s+display: flex;\s+flex-direction: column;\s+overflow: hidden;/,
		);
	});
});
