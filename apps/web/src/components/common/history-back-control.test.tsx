import { describe, expect, test } from "bun:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryBackControl } from "#/components/common/history-back-control";

async function renderBackControl(initialEntries: string[]) {
	const rootRoute = createRootRoute({
		component: HistoryBackControl,
	});
	const history = createMemoryHistory({
		initialEntries: [initialEntries[0] ?? "/"],
	});
	for (const entry of initialEntries.slice(1)) {
		history.push(entry);
	}
	const router = createRouter({
		history,
		isServer: true,
		origin: "https://tripwire.test",
		routeTree: rootRoute,
	});
	await router.load();
	return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("HistoryBackControl", () => {
	test("is absent on a direct entry", async () => {
		expect(await renderBackControl(["/"])).not.toContain(
			"history-back-control",
		);
	});

	test("is present after an in-app navigation", async () => {
		const markup = await renderBackControl(["/", "/?detail=run-1"]);
		expect(markup).toContain('data-layout-role="history-back-control"');
		expect(markup).toContain('aria-label="Back"');
		expect(markup).toContain(">Back<");
	});
});
