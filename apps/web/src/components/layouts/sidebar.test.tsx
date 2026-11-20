import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	SidebarFrame,
	SidebarPrimary,
	SidebarSecondary,
} from "#/components/layouts/sidebar";

describe("sidebar composition", () => {
	test("keeps the primary navigation mounted beside secondary content", () => {
		const markup = renderToStaticMarkup(
			<SidebarFrame
				data-layout="dashboard"
				secondary={<nav aria-label="Settings">Settings navigation</nav>}
			>
				<SidebarPrimary aria-label="Primary" condensed>
					Primary navigation
				</SidebarPrimary>
			</SidebarFrame>,
		);

		expect(markup).toContain('data-slot="frame"');
		expect(markup).toContain('data-secondary=""');
		expect(markup).toContain('data-slot="secondary-rail"');
		expect(markup).toContain('data-layout="dashboard"');
		expect(markup).toContain('data-condensed=""');
		expect(markup).toContain('data-slot="primary"');
		expect(markup).toContain('aria-label="Primary"');
		expect(markup).toContain('data-slot="secondary"');
		expect(markup).toContain('<nav aria-label="Settings">');
	});

	test("merges custom attributes with the primitive contract", () => {
		const markup = renderToStaticMarkup(
			<SidebarSecondary
				aria-label="Route navigation"
				className="custom-secondary"
			>
				Nested routes
			</SidebarSecondary>,
		);

		expect(markup).toContain('aria-label="Route navigation"');
		expect(markup).toContain('data-slot="secondary"');
		expect(markup).toContain("custom-secondary");
	});
});
