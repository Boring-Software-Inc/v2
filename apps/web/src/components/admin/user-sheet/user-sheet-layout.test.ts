import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutCss = readFileSync(
	new URL("../../../design-system/layout-contract.css", import.meta.url),
	"utf8",
);

function declarationsFor(selector: string): string {
	const start = layoutCss.indexOf(`${selector} {`);
	expect(start).toBeGreaterThanOrEqual(0);
	return layoutCss.slice(start, layoutCss.indexOf("}", start));
}

const navSelector = '[data-layout-role="user-sheet-nav"]';

describe("user-sheet navigation layout", () => {
	test("keeps the nav at its content height instead of shrinking into a vertical scroller", () => {
		const nav = declarationsFor(navSelector);
		expect(nav).toContain("flex-shrink: 0;");
		expect(nav).toContain("overflow-y: hidden;");
		expect(nav).not.toMatch(/(?:max-)?block-size:\s*\d/);
	});

	test("preserves sticky positioning and contained horizontal scrolling", () => {
		const nav = declarationsFor(navSelector);
		expect(nav).toContain("position: sticky;");
		expect(nav).toContain("inset-block-start: 0;");
		expect(nav).toContain("min-inline-size: 0;");
		expect(nav).toContain("overflow-x: auto;");
		expect(declarationsFor(`${navSelector} button`)).toContain(
			"flex: 0 0 auto;",
		);
	});

	test("retains padding around the keyboard focus outline", () => {
		expect(declarationsFor(navSelector)).toContain(
			"padding: var(--space-2) var(--space-4);",
		);
		expect(layoutCss).toContain(`${navSelector} button:focus-visible,`);
		expect(layoutCss).toContain(
			"outline: var(--line-width) solid var(--tw-boundary-focus);",
		);
	});
});
