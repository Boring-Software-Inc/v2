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
import { type NestedNavItem, ShellNav } from "#/components/layouts/shell-nav";
import type { OrgHomeState } from "#/lib/onboarding.functions";
import type { OrgWithPermissions } from "#/lib/org.functions";
import { orgContextQueryOptions, orgHomeQueryOptions } from "#/lib/org.query";

async function renderNav(
	queue: number | undefined,
	permissions: OrgWithPermissions["permissions"],
	parent?: NestedNavItem["parent"],
	collapsed = false,
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
		component: () => (
			<ShellNav collapsed={collapsed} counts={{ queue }} variant="rail" />
		),
	});
	const run = createRoute({
		getParentRoute: () => root,
		path: "runs/$runId",
		component: () => (
			<ShellNav
				counts={{ queue }}
				nestedItem={parent ? { parent, label: "Run #42" } : undefined}
				scope={{ org: "team", repo: "scratch" }}
				variant="rail"
			/>
		),
	});
	const router = createRouter({
		isServer: true,
		origin: "https://tripwire.test",
		routeTree: root.addChildren([activity, run]),
		history: createMemoryHistory({
			initialEntries: [parent ? "/runs/42" : "/team/scratch/activity"],
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

async function renderOrgNav(repos: OrgHomeState["repos"]) {
	const client = new QueryClient();
	client.setQueryData(orgContextQueryOptions("team").queryKey, {
		id: "org-team",
		slug: "team",
		name: "Team",
		role: "member",
		isPersonal: false,
		avatarHue: null,
		timezone: null,
		permissions: ["analytics:read"],
	});
	client.setQueryData(orgHomeQueryOptions("team").queryKey, {
		hasInstallation: true,
		repos,
	} satisfies OrgHomeState);
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const home = createRoute({
		getParentRoute: () => root,
		path: "$org/home",
		component: () => <ShellNav counts={{}} variant="rail" />,
	});
	const router = createRouter({
		isServer: true,
		origin: "https://tripwire.test",
		routeTree: root.addChildren([home]),
		history: createMemoryHistory({ initialEntries: ["/team/home"] }),
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

	test("collapsed links keep their tooltip labels as accessible names", async () => {
		const html = await renderNav(
			7,
			["moderation:read", "activity:read", "rules:read"],
			undefined,
			true,
		);
		expect(html).toContain('aria-label="Human review"');
		expect(html).toContain('aria-label="Activity"');
		expect(html).toContain('aria-label="Rules"');
		expect(html).not.toContain("to review</span>");
	});
});

describe("ShellNav run navigation", () => {
	test.each([
		["activity", "Activity"],
		["moderation", "Human review"],
	] as const)("nests the active run under %s", async (parent, label) => {
		const html = await renderNav(
			undefined,
			["moderation:read", "activity:read"],
			parent,
		);
		expect(html).toContain('href="/team/scratch/moderation"');
		expect(html).toContain('href="/team/scratch/activity"');
		expect(html).toMatch(/aria-current="page"[^>]*href="\/runs\/42"/);
		expect(html).toContain(label);
		expect(html.indexOf(label)).toBeLessThan(html.indexOf('title="Run #42"'));
		if (parent === "moderation") {
			expect(html.indexOf('title="Run #42"')).toBeLessThan(
				html.indexOf(">Activity<"),
			);
		}
	});
});

describe("ShellNav org navigation", () => {
	test("hides analytics when the org has no repos", async () => {
		const html = await renderOrgNav([]);
		expect(html).toContain('href="/team/home"');
		expect(html).not.toContain('href="/team/analytics"');
	});

	test("shows analytics when the org has repos", async () => {
		const html = await renderOrgNav([
			{
				id: "repo-1",
				forge: "github",
				owner: "tripwire",
				fullName: "tripwire/team-web",
				name: "team-web",
				armed: true,
				pendingModeration: 0,
				blocked24h: 0,
				lastActivityAt: null,
			},
		]);
		expect(html).toContain('href="/team/analytics"');
	});
});
