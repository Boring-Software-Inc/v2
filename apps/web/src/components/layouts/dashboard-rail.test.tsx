import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsedSidebarToggle } from "#/components/layouts/dashboard-rail";

describe("DashboardRail brand transition", () => {
	test("slides the expand glyph up beneath the compact mark", () => {
		const html = renderToStaticMarkup(
			<CollapsedSidebarToggle label="Expand sidebar" onAction={() => {}} />,
		);

		expect(html).toContain("group/sidebar-toggle");
		expect(html).toContain('height="22"');
		expect(html).toContain('width="22"');
		expect(html).toContain("group-hover/sidebar-toggle:translate-y-0");
		expect(html).toMatch(/class="[^"]*-translate-y-2[^"]*opacity-0/);
	});
});
