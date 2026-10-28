import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import type { GitCafeConnectionStatus } from "@tripwire/contracts";
import { renderToString } from "react-dom/server";
import { GitCafeConnectionProgress } from "#/components/organizations/gitcafe-connection-progress";
import { gitCafeConnectionStatusQueryOptions } from "#/lib/gitcafe-connection.query";

async function renderStatus(value: GitCafeConnectionStatus, error = false) {
	const client = new QueryClient();
	const options = gitCafeConnectionStatusQueryOptions(
		"team",
		"installation-test",
		"01900000-0000-7000-8000-000000000001",
	);
	client.setQueryData(options.queryKey, value);
	if (error)
		client
			.getQueryCache()
			.find({ queryKey: options.queryKey })
			?.setState({ status: "error", error: new Error("status unavailable") });
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<GitCafeConnectionProgress
					installationId="installation-test"
					jobId="01900000-0000-7000-8000-000000000001"
					org={{ name: "Team", slug: "team" }}
					onRetry={() => undefined}
					retryPending={false}
					retryError={null}
				/>
			</QueryClientProvider>
		),
	});
	const home = createRoute({ getParentRoute: () => root, path: "/" });
	const orgHome = createRoute({
		getParentRoute: () => root,
		path: "$org/home",
	});
	const router = createRouter({
		isServer: true,
		origin: "https://tripwire.test",
		routeTree: root.addChildren([home, orgHome]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	const html = renderToString(<RouterProvider router={router} />);
	client.clear();
	return html;
}

describe("GitCafe setup progress", () => {
	test("installation changes, expiry and server setup failures identify different recovery steps", async () => {
		for (const [reason, message] of [
			["installation-mismatch", "repository access changed"],
			["expired", "authorization expired"],
			["configuration", "server isn&#x27;t configured"],
			["queue-unavailable", "couldn&#x27;t start the connection"],
		] as const) {
			const html = await renderStatus({ status: "refused", reason });
			expect(html).toContain(message);
			expect(html).not.toContain(
				"verify this installation with your current access",
			);
			expect(html).not.toContain("GitCafe connected to");
		}
	});
	test("queue acceptance remains pending instead of claiming success", async () => {
		const html = await renderStatus({ status: "pending" });
		expect(html).toContain("Connection pending");
		expect(html).not.toContain("GitCafe connected to");
	});
	test("only persisted success shows repos connected with protection off", async () => {
		const html = await renderStatus({ status: "connected", repoCount: 1 });
		expect(html).toContain("GitCafe connected to Team");
		expect(html).toContain("1 repo is connected with protection off");
		expect(html).toContain('href="/team/home"');
		expect(html).not.toContain("Turn on");
	});
	test("refusal and retry explain recovery without success", async () => {
		for (const status of [
			{ status: "refused", reason: "not-admin" },
			{ status: "retry" },
		] as const) {
			const html = await renderStatus(status);
			expect(html).toContain("Authorize again on GitCafe");
			expect(html).not.toContain("GitCafe connected to");
		}
	});
	test("a failed fresh status read cannot display cached success", async () => {
		const html = await renderStatus(
			{ status: "connected", repoCount: 1 },
			true,
		);
		expect(html).not.toContain("GitCafe connected to");
		expect(html).toContain("read connection progress. Check your connection");
	});
	test("name collisions explain selection and org recovery without claiming another org owns the installation", async () => {
		const html = await renderStatus({
			status: "refused",
			reason: "repository-conflict",
		});
		expect(html).toContain("same name as another repo in this Tripwire org");
		expect(html).toContain("Change the GitCafe repo selection");
		expect(html).toContain("connect to a different Tripwire org");
		expect(html).not.toContain("connected to another org");
		expect(html).not.toContain("GitCafe connected to");
	});
});
