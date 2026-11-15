import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartFrame } from "./chart";

describe("ChartFrame semantics", () => {
	test("uses the page-section heading level", () => {
		const html = renderToStaticMarkup(
			<ChartFrame title="Verdicts">Chart body</ChartFrame>,
		);

		expect(html).toContain("<h2");
		expect(html).not.toContain("<h3");
	});
});
