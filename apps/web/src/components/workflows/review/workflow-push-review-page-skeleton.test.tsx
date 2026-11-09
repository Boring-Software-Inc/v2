import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewSkeleton } from "./workflow-push-review-page-skeleton";

describe("workflow push review skeleton", () => {
	test("uses the same semantic page hierarchy as the loaded review", () => {
		const markup = renderToStaticMarkup(<ReviewSkeleton />);
		expect(markup).toContain('data-layout-role="page"');
		expect(markup).toContain(
			'<h1 data-type-role="page-title">Review push</h1>',
		);
		expect(markup).toContain('data-layout-role="page-metadata"');
		expect(markup).toContain('data-layout-role="page-body"');
		expect(markup).toContain(
			'data-layout-role="workflow-review-skeleton-diff"',
		);
	});
});
