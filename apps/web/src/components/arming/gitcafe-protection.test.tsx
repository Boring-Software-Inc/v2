import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { ArmCallout } from "#/components/arming/arm-callout";
import { RepoSetupChecklist } from "#/components/setup/repo-setup-checklist";
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
	test("a connection manager can explicitly arm through the callout", () => {
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
					progress={setupProgress(state.facts)}
				/>
			</QueryClientProvider>,
		);
		expect(html).not.toContain("GitCafe checks aren&#x27;t available yet");
		expect(html).toContain("connect Tripwire on GitHub too");
		expect(html).toContain("<button");
		client.clear();
	});
});
