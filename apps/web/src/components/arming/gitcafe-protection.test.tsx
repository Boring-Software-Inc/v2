import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { ArmCallout } from "#/components/arming/arm-callout";
import { RepoSetupChecklist } from "#/components/setup/repo-setup-checklist";
import { InstallAction } from "#/components/setup/setup-step-actions";
import { orgContextQueryOptions } from "#/lib/org.query";
import { setupProgress } from "#/lib/repo-setup";
import type { RepoSetupState } from "#/lib/repo-setup.functions";

describe("GitCafe protection controls", () => {
	test("permission loading and non-managers expose no arm button", () => {
		for (const permissions of [null, []]) {
			const client = new QueryClient();
			if (permissions)
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
			const html = renderToString(
				<QueryClientProvider client={client}>
					<ArmCallout
						forge="gitcafe"
						org="team"
						repo="scratch"
						repoFullName="team/scratch"
					/>
				</QueryClientProvider>,
			);
			expect(html).not.toContain("<button");
			expect(html).toContain(
				"Imported pull requests and issues do not send GitCafe events",
			);
			client.clear();
		}
	});
	test("a connection manager can explicitly arm through the callout", async () => {
		const client = new QueryClient();
		client.setQueryData(orgContextQueryOptions("team").queryKey, {
			id: "org-team",
			slug: "team",
			name: "Team",
			role: "admin",
			isPersonal: false,
			avatarHue: null,
			timezone: null,
			permissions: ["connections:manage"],
		});
		for (const variant of ["hero", "banner"] as const) {
			const html = renderToString(
				<QueryClientProvider client={client}>
					<ArmCallout
						forge="gitcafe"
						org="team"
						repo="scratch"
						repoFullName="team/scratch"
						variant={variant}
					/>
				</QueryClientProvider>,
			);
			expect(html).not.toContain("GitCafe checks aren&#x27;t available yet");
			expect(html).toContain(
				"Imported pull requests and issues do not send GitCafe events",
			);
			expect(html).toContain("GitCafe checks do not block merges on GitHub");
			expect(html).toContain("Turn on Tripwire");
			expect(html).toContain("<button");
		}
		const root = createRootRoute({
			component: () => (
				<QueryClientProvider client={client}>
					<InstallAction org="team" forge="gitcafe" />
				</QueryClientProvider>
			),
		});
		const home = createRoute({ getParentRoute: () => root, path: "/" });
		const router = createRouter({
			isServer: true,
			origin: "https://tripwire.test",
			routeTree: root.addChildren([home]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		await router.load();
		const install = renderToString(<RouterProvider router={router} />);
		expect(install).toContain("Manage GitCafe connection");
		expect(install).not.toContain("Choose repos on GitHub");
		client.clear();
	});
	test("the repo setup checklist retains its normal setup and mirror notice", () => {
		const state: RepoSetupState = {
			forge: "gitcafe",
			repoId: "repo-test",
			agent: null,
			facts: {
				installed: true,
				armed: false,
				enabledRuleIds: [],
				customRulesOn: 0,
				workflowsOn: 0,
				firstCheck: null,
				nextChangeRequest: null,
				responsesChosen: false,
				onboardingStarted: false,
				onboardingCompleted: false,
			},
		};
		const client = new QueryClient();
		const html = renderToString(
			<QueryClientProvider client={client}>
				<RepoSetupChecklist
					org="team"
					repo="scratch"
					state={state}
					progress={setupProgress(state.facts, state.forge)}
				/>
			</QueryClientProvider>,
		);
		expect(html).not.toContain("GitCafe checks aren&#x27;t available yet");
		expect(html).toContain("connect Tripwire on GitHub too");
		expect(html).toContain("GitCafe connected");
		expect(html).not.toContain("GitHub App installed");
		expect(html).not.toContain("Account age");
		expect(html).not.toContain("Rate limit");
		expect(html).not.toContain("Merged change requests");
		expect(html).toContain("<button");
		client.clear();
	});
});
