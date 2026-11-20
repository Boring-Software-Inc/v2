import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GifGridSkeleton } from "#/components/responses/blocks/gif-search";

test("GIF loading preserves the two-column media grid with shimmer surfaces", () => {
	const html = renderToStaticMarkup(<GifGridSkeleton />);

	expect(html).toContain('aria-label="Loading GIFs"');
	expect(
		html.match(/data-layout-role="gif-grid-skeleton-column"/g),
	).toHaveLength(2);
	expect(html.match(/data-layout-role="gif-grid-skeleton-item"/g)).toHaveLength(
		6,
	);
	expect(html.match(/data-slot="skeleton"/g)).toHaveLength(6);
});
