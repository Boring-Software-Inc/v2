import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPaletteButton } from "#/components/layouts/command-palette-launcher";

describe("CommandPaletteButton sidebar rhythm", () => {
	test("expanded and collapsed launchers share the same owned search icon", () => {
		const expanded = renderToStaticMarkup(<CommandPaletteButton wide />);
		const collapsed = renderToStaticMarkup(
			<CommandPaletteButton collapsed wide />,
		);

		expect(expanded).toContain('data-layout-role="sidebar-search-icon"');
		expect(collapsed).toContain('data-layout-role="sidebar-search-icon"');
		expect(expanded).toContain('width="16"');
		expect(collapsed).toContain('width="16"');
		expect(expanded).not.toContain('width="14"');
		expect(collapsed).not.toContain('width="18"');
		expect(expanded).toContain('data-layout-role="sidebar-search-trigger"');
		expect(collapsed).toContain('data-layout-role="sidebar-search-trigger"');
		expect(expanded).toContain('data-layout-role="sidebar-search-label"');
		expect(collapsed).not.toContain('data-layout-role="sidebar-search-label"');
		expect(collapsed).toContain('data-collapsed="true"');
	});
});
