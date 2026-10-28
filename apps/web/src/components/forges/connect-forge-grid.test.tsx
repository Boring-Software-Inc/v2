import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	dehydrate,
	hydrate,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { ForgeGrid } from "#/components/auth/forge-grid";
import { ConnectForgeGrid } from "#/components/forges/connect-forge-grid";
import { providerAvailabilityQueryOptions } from "#/lib/auth.query";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { orgContextQueryOptions } from "#/lib/org.query";

function button(markup: string, label: string) {
	return (
		markup
			.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
			?.find((element) => element.includes(label)) ?? ""
	);
}

function render(client: QueryClient, org: string | null) {
	return renderToString(
		<QueryClientProvider client={client}>
			<ConnectForgeGrid org={org} />
		</QueryClientProvider>,
	);
}

describe("Connect uses the login availability decision", () => {
	test("the same cached result enables both grids across hydration", () => {
		const client = new QueryClient();
		client.setQueryData(providerAvailabilityQueryOptions().queryKey, {
			available: ["github", "gitcafe"],
		});
		client.setQueryData(orgContextQueryOptions("team").queryKey, {
			id: "org-team",
			slug: "team",
			name: "Team",
			role: "connection-manager",
			isPersonal: false,
			avatarHue: null,
			timezone: null,
			permissions: ["connections:manage"],
		});
		for (const forge of ["github", "gitcafe"] as const)
			client.setQueryData(orgInstallUrlQueryOptions("team", forge).queryKey, {
				status: "ready",
				url: `https://${forge === "gitcafe" ? "git.cafe" : "github.com"}/apps/example/install`,
			});
		const login = renderToString(
			<QueryClientProvider client={client}>
				<ForgeGrid redirect={undefined} />
			</QueryClientProvider>,
		);
		const connect = render(client, "team");
		for (const label of ["GitHub", "GitCafe"]) {
			expect(button(login, label)).not.toContain('aria-disabled="true"');
			expect(button(connect, label)).not.toContain('aria-disabled="true"');
			expect(button(connect, label)).not.toContain('aria-busy="true"');
		}
		expect(connect).toContain("var(--brand-gitcafe)");
		expect(
			readFileSync(
				new URL("../../styles.css", import.meta.url),
				"utf8",
			).toLowerCase(),
		).toContain("#a88bfa");
		const hydrated = new QueryClient();
		hydrate(hydrated, dehydrate(client));
		expect(render(hydrated, "team")).toBe(connect);
		client.clear();
		hydrated.clear();
	});
	test("unavailable providers stay disabled for Connect even if an install URL was cached", () => {
		const client = new QueryClient();
		client.setQueryData(providerAvailabilityQueryOptions().queryKey, {
			available: ["github"],
		});
		client.setQueryData(orgInstallUrlQueryOptions("team", "gitcafe").queryKey, {
			status: "ready",
			url: "https://git.cafe/apps/example/install",
		});
		expect(button(render(client, "team"), "GitCafe")).toContain(
			'aria-disabled="true"',
		);
		client.clear();
	});
	test("org access and provider lookup errors remain action-specific blocks", () => {
		const client = new QueryClient();
		const options = providerAvailabilityQueryOptions();
		client.setQueryData(options.queryKey, { available: ["github", "gitcafe"] });
		const noOrg = render(client, null);
		expect(noOrg).toContain("Open an org first");
		expect(button(noOrg, "GitCafe")).toContain("aria-describedby=");
		client
			.getQueryCache()
			.find({ queryKey: options.queryKey })
			?.setState({ status: "error", error: new Error("lookup failed") });
		const failed = render(client, null);
		expect(failed).toContain("Providers are unavailable right now");
		expect(button(failed, "GitCafe")).toContain('aria-disabled="true"');
		client.clear();
	});
});
