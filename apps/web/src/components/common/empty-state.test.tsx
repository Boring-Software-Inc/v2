import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState, EmptyStateTitle } from "#/components/common/empty-state";
import { NotFoundBody } from "#/components/not-found";

describe("Tripwire empty-state contract", () => {
	test("adds compact ghost art to product empty states by default", () => {
		const html = renderToStaticMarkup(<EmptyState size="sm" />);

		expect(html).toContain('data-slot="empty-art"');
		expect(html).toContain('data-size="compact"');
		expect(html).not.toContain("data-minigame");
	});

	test("sets a page-level empty heading without changing nested defaults", () => {
		const pageTitle = renderToStaticMarkup(
			<EmptyStateTitle headingLevel={2}>No agents connected</EmptyStateTitle>,
		);
		const nestedTitle = renderToStaticMarkup(
			<EmptyStateTitle>No results</EmptyStateTitle>,
		);

		expect(pageTitle).toContain('<h2 data-slot="empty-state-title">');
		expect(nestedTitle).toContain('<h3 data-slot="empty-state-title">');
	});

	test("keeps the runner minigame exclusive to the 404 surface", () => {
		const html = renderToStaticMarkup(<NotFoundBody signedIn />);

		expect(html).toContain('data-minigame=""');
	});
});
