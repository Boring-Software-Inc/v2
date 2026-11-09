import { describe, expect, test } from "bun:test";
import {
	dehydrate,
	hydrate,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import type { ConfiguredSignInProviderIds } from "@tripwire/contracts";
import { renderToString } from "react-dom/server";
import { ForgeGrid } from "#/components/auth/forge-grid";
import { providerAvailabilityQueryOptions } from "#/lib/auth.query";

function renderGrid(client: QueryClient) {
	return renderToString(
		<QueryClientProvider client={client}>
			<ForgeGrid redirect="/org/test" />
		</QueryClientProvider>,
	);
}

function button(markup: string, label: string) {
	const found = markup
		.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
		?.find((element) => element.includes(label));
	expect(found).toBeDefined();
	return found ?? "";
}

describe("sign-in provider SSR", () => {
	const providerCases: ConfiguredSignInProviderIds[] = [
		[],
		["github"],
		["github", "gitcafe"],
	];
	for (const ids of providerCases) {
		test(`initial paint and hydrated cache agree for ${ids.join(",") || "no providers"}`, () => {
			const server = new QueryClient();
			server.setQueryData(providerAvailabilityQueryOptions().queryKey, {
				available: ids,
			});
			const markup = renderGrid(server);
			const client = new QueryClient();
			hydrate(client, dehydrate(server));
			expect(renderGrid(client)).toBe(markup);
			for (const [id, label] of [
				["github", "GitHub"],
				["gitcafe", "GitCafe"],
				["opengit", "OpenGit"],
				["gitlab", "GitLab"],
			] as const) {
				expect(button(markup, label).includes('aria-disabled="true"')).toBe(
					!ids.includes(id),
				);
			}
			expect(markup).toContain("grid grid-cols-2 gap-2");
			server.clear();
			client.clear();
		});
	}

	test("provider lookup pending keeps all cells busy until the one result arrives", () => {
		const client = new QueryClient();
		const markup = renderGrid(client);
		for (const label of ["GitHub", "GitCafe", "OpenGit", "GitLab"]) {
			expect(button(markup, label)).toContain('aria-busy="true"');
		}
		client.clear();
	});

	test("lookup errors block even previously configured providers with an accessible explanation", () => {
		const client = new QueryClient();
		const options = providerAvailabilityQueryOptions();
		client.setQueryData(options.queryKey, { available: ["github", "gitcafe"] });
		client
			.getQueryCache()
			.find({ queryKey: options.queryKey })
			?.setState({
				status: "error",
				error: new Error("provider lookup failed"),
			});
		const markup = renderGrid(client);
		for (const label of ["GitHub", "GitCafe"]) {
			expect(button(markup, label)).toContain('aria-disabled="true"');
			expect(button(markup, label)).toContain("aria-describedby=");
		}
		expect(markup).toContain("Refresh the page to try again.");
		client.clear();
	});
});
