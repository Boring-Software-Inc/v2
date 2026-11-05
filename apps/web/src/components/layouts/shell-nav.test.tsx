import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { ShellNav } from "#/components/layouts/shell-nav";
import type { OrgWithPermissions } from "#/lib/org.functions";
import { orgContextQueryOptions } from "#/lib/org.query";

async function renderNav(
	queue: number | undefined,
	permissions: OrgWithPermissions["permissions"],
) {
	const client = new QueryClient();
	client.setQueryData(orgContextQueryOptions("team").queryKey, {
		id: "org-team",
		slug: "team",
		name: "Team",
		role: "member",
		isPersonal: false,
		avatarHue: null,
		timezone: null,
		permissions,
	});
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const activity = createRoute({
		getParentRoute: () => root,
		path: "$org/$repo/activity",
		component: () => <ShellNav counts={{ queue }} />,
	});
	const router = createRouter({
		isServer: true,
		origin: "https://tripwire.test",
		routeTree: root.addChildren([activity]),
		history: createMemoryHistory({
			initialEntries: ["/team/scratch/activity"],
		}),
	});
	await router.load();
	for (const match of router.state.matches) {
		if (match.error) throw match.error;
	}
	const html = renderToString(<RouterProvider router={router} />).replaceAll(
		"<!-- -->",
		"",
	);
	client.clear();
	return html;
}

describe("ShellNav review count", () => {
	test.each([0, 7])("renders the supplied numeric count %i", async (queue) => {
		const html = await renderNav(queue, ["moderation:read", "activity:read"]);
		expect(html).toContain('href="/team/scratch/moderation"');
		expect(html).toContain(`${queue}<span class="sr-only"> to review</span>`);
		expect(html).toContain('href="/team/scratch/activity"');
	});

	test("an absent count omits the tally but keeps the review route", async () => {
		const html = await renderNav(undefined, ["moderation:read"]);
		expect(html).toContain("Human review");
		expect(html).toContain('href="/team/scratch/moderation"');
		expect(html).not.toContain("to review</span>");
	});

	test("a count does not bypass the moderation permission", async () => {
		const html = await renderNav(7, ["activity:read"]);
		expect(html).toContain('href="/team/scratch/activity"');
		expect(html).not.toContain("Human review");
		expect(html).not.toContain("to review</span>");
	});
});
