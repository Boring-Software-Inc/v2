import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsedSidebarToggle } from "#/components/layouts/dashboard-rail";

describe("DashboardRail brand transition", () => {
	test("keeps the expand glyph hidden beneath the fixed-size mark at rest", () => {
		const html = renderToStaticMarkup(
			<CollapsedSidebarToggle label="Expand sidebar" onAction={() => {}} />,
		);

		expect(html).toContain('data-layout-role="sidebar-brand-toggle"');
		expect(html).toContain('data-layout-role="sidebar-brand-mark"');
		expect(html).toContain('height="18"');
		expect(html).toContain('width="28"');
		expect(html).toMatch(
			/class="[^"]*opacity-0" data-layout-role="sidebar-brand-expand-icon"/,
		);
	});
});
