import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import type { OrganizationForgeConnection } from "@tripwire/contracts";
import { renderToString } from "react-dom/server";
import { GitCafeRepositorySelection } from "#/components/forges/gitcafe-repository-selection";
import { OrganizationConnectionRow } from "#/components/forges/organization-connection-row";
import { OrganizationConnectionsPage } from "#/components/forges/organization-connections-page";
import { CollapsibleGroup } from "#/design-system/ui/collapsible";
import { providerAvailabilityQueryOptions } from "#/lib/auth.query";
import { organizationConnectionsQueryOptions } from "#/lib/connections.query";
import { orgContextQueryOptions } from "#/lib/org.query";

const connection: OrganizationForgeConnection = {
	forge: "gitcafe",
	installations: [
		{
			installationId: "installation-one",
			owner: "boring",
			accountType: "Organization",
		},
	],
	repositories: [
		{
			id: "repo-one",
			fullName: "boring/scratch",
			installationId: "installation-one",
		},
	],
};

function createClient(canManage: boolean) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, retryOnMount: false } },
	});
	client.setQueryData(providerAvailabilityQueryOptions().queryKey, {
		available: ["gitcafe"],
	});
	client.setQueryData(orgContextQueryOptions("team").queryKey, {
		id: "org-team",
		slug: "team",
		name: "Team",
		role: "custom-role",
		isPersonal: false,
		avatarHue: null,
		timezone: null,
		permissions: canManage ? ["connections:manage"] : [],
	});
	client.setQueryData(organizationConnectionsQueryOptions("team").queryKey, [
		connection,
	]);
	return client;
}

async function renderPage(client: QueryClient) {
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<OrganizationConnectionsPage org="team" />
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/"] }),
		isServer: true,
		origin: "http://localhost",
		routeTree: rootRoute,
	});
	await router.load();
	return renderToString(<RouterProvider router={router} />);
}

async function page(canManage: boolean) {
	const client = createClient(canManage);
	const markup = await renderPage(client);
	client.clear();
	return markup;
}

test("organization managers see installation repositories without an OAuth account or expiry warning", async () => {
	const markup = await page(true);
	expect(markup).toContain("boring/scratch");
	expect(markup).toContain(
		'aria-label="Disconnect boring/scratch from GitCafe"',
	);
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).toContain('data-layout-role="gitcafe-mark"');
	expect(markup).not.toContain("Access expired");
	expect(markup).not.toContain("Reconnect GitCafe");
});

test("a non-manager cannot see cached repository names or disconnect controls", async () => {
	const markup = await page(false);
	expect(markup).toContain("Ask an admin of this org");
	expect(markup).not.toContain("boring/scratch");
	expect(markup).not.toContain("Disconnect");
	expect(markup).not.toContain("Connect repos");
	expect(markup).not.toContain("Sync repositories");
});

test("empty GitCafe installations remain manageable and unknown metadata offers no disconnect", () => {
	const empty = renderToString(
		<QueryClientProvider client={createClient(true)}>
			<CollapsibleGroup>
				<OrganizationConnectionRow
					org="team"
					connection={{ ...connection, repositories: [] }}
					onCheckAccess={async () => undefined}
				/>
			</CollapsibleGroup>
		</QueryClientProvider>,
	);
	expect(empty).toContain("0 repos");
	expect(empty).toContain("Sync repositories");
	expect(empty).not.toMatch(/<button[^>]*\sdisabled(?:=""|\s|>)/);
	const unknown = renderToString(
		<QueryClientProvider client={new QueryClient()}>
			<CollapsibleGroup defaultValue={["gitcafe"]}>
				<OrganizationConnectionRow
					org="team"
					connection={{ ...connection, installations: [] }}
					onCheckAccess={async () => undefined}
				/>
			</CollapsibleGroup>
		</QueryClientProvider>,
	);
	expect(unknown).toContain("boring/scratch");
	expect(unknown).not.toContain("Disconnect");
});

test("a failed access refresh keeps the cached repository list and its controls", async () => {
	const client = createClient(true);
	try {
		await expect(
			client.fetchQuery({
				...organizationConnectionsQueryOptions("team"),
				staleTime: 0,
				retry: false,
				queryFn: async () => {
					throw new Error("Controlled refresh outage");
				},
			}),
		).rejects.toThrow("Controlled refresh outage");
		const markup = await renderPage(client);
		expect(markup).toContain("boring/scratch");
		expect(markup).toContain(
			'aria-label="Disconnect boring/scratch from GitCafe"',
		);
		expect(markup).toContain("Couldn't refresh access".replace("'", "&#x27;"));
	} finally {
		client.clear();
	}
});

test("a first-load failure uses the actionable error state", async () => {
	const client = createClient(true);
	client.removeQueries({
		queryKey: organizationConnectionsQueryOptions("team").queryKey,
	});
	try {
		await expect(
			client.fetchQuery({
				...organizationConnectionsQueryOptions("team"),
				retry: false,
				queryFn: async () => {
					throw new Error("Unsupported saved forge");
				},
			}),
		).rejects.toThrow("Unsupported saved forge");
		const markup = await renderPage(client);
		expect(markup).toContain("Couldn&#x27;t load connections");
		expect(markup).toContain("saved forge connections");
		expect(markup).toContain("Try again");
	} finally {
		client.clear();
	}
});

test("an existing GitCafe installation can change and sync its repository selection", async () => {
	const markup = await page(true);
	expect(markup).toContain("Manage repositories on GitCafe");
	expect(markup).toContain(
		"https://git.cafe/orgs/boring/settings/apps/installation-one",
	);
	expect(markup).toContain("Sync repositories");
});

test("sync shares provider availability while native repository management stays accessible", () => {
	for (const state of ["pending", "unavailable", "error"] as const) {
		const client = new QueryClient();
		if (state !== "pending")
			client.setQueryData(providerAvailabilityQueryOptions().queryKey, {
				available: [],
			});
		if (state === "error")
			client
				.getQueryCache()
				.find({ queryKey: providerAvailabilityQueryOptions().queryKey })
				?.setState({
					status: "error",
					error: new Error("Controlled availability outage"),
				});
		const markup = renderToString(
			<QueryClientProvider client={client}>
				<GitCafeRepositorySelection
					org="team"
					installations={connection.installations}
					repositories={connection.repositories}
				/>
			</QueryClientProvider>,
		);
		expect(markup).toContain("Manage repositories on GitCafe");
		expect(markup).toMatch(/<button[^>]*\sdisabled(?:=""|\s|>)/);
		expect(markup).toContain("aria-describedby=");
		expect(markup).toContain(
			state === "pending"
				? "Checking repository sync availability"
				: state === "error"
					? "Couldn&#x27;t check repository sync availability"
					: "GitCafe repository sync isn&#x27;t available",
		);
		client.clear();
	}
});

test("same-owner installations identify the current repository selection separately from the empty one", async () => {
	const client = createClient(true);
	client.setQueryData(organizationConnectionsQueryOptions("team").queryKey, [
		{
			...connection,
			repositories: [
				...connection.repositories,
				{
					id: "unassigned-repo",
					fullName: "boring/unassigned",
					installationId: null,
				},
			],
			installations: [
				{
					installationId: "older-empty-installation",
					owner: "boring",
					accountType: "Organization",
				},
				...connection.installations,
			],
		},
	]);
	const markup = await renderPage(client);
	expect(markup).toContain(
		'aria-label="Sync GitCafe repositories for boring, 0 connected repos"',
	);
	expect(markup).toContain(
		'aria-label="Sync GitCafe repositories for boring, 1 connected repo"',
	);
	expect(markup).toContain("0 connected");
	expect(markup).toContain("1 connected");
	expect(markup).toContain(
		"https://git.cafe/orgs/boring/settings/apps/older-empty-installation",
	);
	expect(markup).toContain(
		"https://git.cafe/orgs/boring/settings/apps/installation-one",
	);
	client.clear();
});
