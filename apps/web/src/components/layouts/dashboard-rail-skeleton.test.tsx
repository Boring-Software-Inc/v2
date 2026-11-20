import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardRailSkeleton } from "./dashboard-rail-skeleton";

describe("DashboardRailSkeleton", () => {
	test("keeps the expanded rail anatomy in place", () => {
		const html = renderToStaticMarkup(
			<DashboardRailSkeleton condensed={false} />,
		);

		expect(html).toContain('data-condensed="false"');
		expect(html).toContain("w-28");
		expect(html).toContain("rounded-pill");
	});

	test("uses icon-sized placeholders in the condensed rail", () => {
		const html = renderToStaticMarkup(<DashboardRailSkeleton condensed />);

		expect(html).toContain('data-condensed="true"');
		expect(html).not.toContain("w-28");
		expect(html.match(/size-\[34px\]/g)?.length).toBe(9);
	});
});
