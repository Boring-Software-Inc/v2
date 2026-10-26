import { expect, test } from "bun:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import type { HomeDigest } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { renderToStaticMarkup } from "react-dom/server";
import { DigestCountsCard } from "#/components/organizations/digest-counts-card";
import { activitySearchSchema } from "#/lib/repo-search";

async function renderDigest(repos: HomeDigest["repos"]) {
	const digest: HomeDigest = {
		from: "2026-10-18T00:00:00.000Z",
		to: "2026-10-25T00:00:00.000Z",
		total: 0,
		repos,
		counts: [
			{ verdict: "block", count: 0 },
			{ verdict: "needs_review", count: 0 },
			{ verdict: "pass", count: 0 },
		],
		caught: null,
	};
	const root = createRootRoute({
		component: () => <DigestCountsCard digest={digest} org="grim" />,
	});
	const activity = createRoute({
		getParentRoute: () => root,
		path: "$org/$repo/activity",
		validateSearch: activitySearchSchema,
	});
	const home = createRoute({ getParentRoute: () => root, path: "/" });
	const router = createRouter({
		isServer: true,
		origin: "http://localhost",
		routeTree: root.addChildren([home, activity]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	return {
		html: renderToStaticMarkup(<RouterProvider router={router} />),
		router,
	};
}

test("digest links preserve the org and repo and open the existing verdict tabs", async () => {
	const { html, router } = await renderDigest([
		{ id: generateId(), name: "scratch" },
	]);
	for (const verdict of ["block", "needs_review", "pass"] as const) {
		expect(html).toContain(`/grim/scratch/activity?verdict=${verdict}`);
		await router.navigate({
			to: "/$org/$repo/activity",
			params: { org: "grim", repo: "scratch" },
			search: { verdict },
		});
		expect(router.state.matches.at(-1)?.search).toEqual({ verdict });
	}
});

test("an aggregate digest offers a repo choice instead of linking every count to the first repo", async () => {
	const { html } = await renderDigest([
		{ id: generateId(), name: "scratch" },
		{ id: generateId(), name: "another-repo" },
	]);
	const triggers = html.match(/aria-haspopup="menu"/g);
	expect(triggers).toHaveLength(4);
	expect(html).not.toContain("/grim/scratch/activity");
	expect(html).not.toContain("/grim/another-repo/activity");
});

test("a digest without a repo has no invented activity destination", async () => {
	const { html } = await renderDigest([]);
	expect(html).toContain("Blocked");
	expect(html).not.toContain("/activity");
	expect(html).not.toContain('aria-haspopup="menu"');
});
