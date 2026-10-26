import { expect, test } from "bun:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityFilters } from "#/components/activity/activity-filters";
import { activitySearchSchema } from "#/lib/repo-search";

async function renderFilters(search: string) {
	const root = createRootRoute();
	const route = createRoute({
		getParentRoute: () => root,
		path: "$org/$repo/activity",
		component: ActivityFilters,
		validateSearch: activitySearchSchema,
	});
	const router = createRouter({
		isServer: true,
		origin: "http://localhost",
		routeTree: root.addChildren([route]),
		history: createMemoryHistory({
			initialEntries: [`/grim/scratch/activity${search}`],
		}),
	});
	await router.load();
	return {
		html: renderToStaticMarkup(<RouterProvider router={router} />),
		search: router.state.location.search,
	};
}

test("normal Activity exposes date and verdict controls without arriving from Home", async () => {
	const { html } = await renderFilters("?verdict=needs_review");
	expect(html).toContain('aria-label="Date: Any date"');
	expect(html).toContain('aria-label="Filter by verdict"');
	expect(html).toContain("Not checked");
});

test("Home's exact period and verdict remain editable without changing their timestamps", async () => {
	const { html, search } = await renderFilters(
		"?verdict=needs_review&from=2026-10-19T17:31:28.377Z&to=2026-10-26T17:31:28.377Z",
	);
	expect(html).toContain('aria-label="Date: Oct 19 to Oct 26"');
	expect(html).toContain('aria-label="Filter by verdict"');
	expect(html).toContain('value="needs_review"');
	expect(html).not.toContain("Not checked");
	expect(search).toEqual({
		verdict: "needs_review",
		from: "2026-10-19T17:31:28.377Z",
		to: "2026-10-26T17:31:28.377Z",
	});
});
