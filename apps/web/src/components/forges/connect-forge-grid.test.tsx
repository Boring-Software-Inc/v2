import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	dehydrate,
	hydrate,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { providerAvailabilitySchema } from "@tripwire/contracts";
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
	test("registered GitHub OAuth survives a missing app slug; only GitCafe needs a valid install slug", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--no-env-file",
				"--eval",
				`
				import { mock } from "bun:test";
				let socialProviders = [{ id: "github" }, { id: "gitcafe" }];
				mock.module("#/lib/server/auth", () => ({
					getAuth: () => ({ $context: Promise.resolve({ socialProviders }) }),
				}));
				const { readProviderAvailability } = await import("#/lib/server/provider-availability");
				const results = [];
				for (const slug of [undefined, "../invalid", "tripwire-test"]) {
					if (slug === undefined) delete process.env.GITCAFE_APP_SLUG;
					else process.env.GITCAFE_APP_SLUG = slug;
					results.push(await readProviderAvailability());
				}
				socialProviders = [{ id: "github" }];
				results.push(await readProviderAvailability());
				process.stdout.write(JSON.stringify(results));
			`,
			],
			{
				cwd: fileURLToPath(new URL("../../../", import.meta.url)),
				env: { NODE_ENV: "test", PATH: process.env.PATH },
				encoding: "utf8",
			},
		);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		const decisions = providerAvailabilitySchema
			.array()
			.parse(JSON.parse(result.stdout));
		expect(decisions).toEqual([
			{ available: ["github"] },
			{ available: ["github"] },
			{ available: ["github", "gitcafe"] },
			{ available: ["github"] },
		]);
		for (const decision of decisions) {
			const client = new QueryClient();
			client.setQueryData(
				providerAvailabilityQueryOptions().queryKey,
				decision,
			);
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
			client.setQueryData(
				orgInstallUrlQueryOptions("team", "github").queryKey,
				{ status: "not-configured" },
			);
			client.setQueryData(
				orgInstallUrlQueryOptions("team", "gitcafe").queryKey,
				{
					status: "ready",
					url: "https://git.cafe/apps/tripwire-test/install",
				},
			);
			const login = renderToString(
				<QueryClientProvider client={client}>
					<ForgeGrid redirect={undefined} />
				</QueryClientProvider>,
			);
			const connect = render(client, "team");
			expect(button(login, "GitHub")).not.toContain('aria-disabled="true"');
			expect(connect).toContain(
				"The GitHub app isn&#x27;t set up on this Tripwire server.",
			);
			for (const markup of [login, connect]) {
				expect(button(markup, "GitCafe").includes('aria-disabled="true"')).toBe(
					!decision.available.includes("gitcafe"),
				);
			}
			client.clear();
		}
	});

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
