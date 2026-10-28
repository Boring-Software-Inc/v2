import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { ArmCallout } from "#/components/arming/arm-callout";
import { RepoSetupChecklist } from "#/components/setup/repo-setup-checklist";
import { orgContextQueryOptions } from "#/lib/org.query";
import { setupProgress } from "#/lib/repo-setup";
import type { RepoSetupState } from "#/lib/repo-setup.functions";

describe("GitCafe connection keeps runtime off", () => {
	test("even a connection manager cannot arm through the callout", () => {
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
			expect(html).toContain("GitCafe protection is off");
			expect(html).not.toContain("Turn on Tripwire");
			expect(html).not.toContain("<button");
		}
		client.clear();
	});
	test("the repo setup checklist shows connected-only status without actions", () => {
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
		const html = renderToString(
			<RepoSetupChecklist
				org="team"
				repo="scratch"
				state={state}
				progress={setupProgress(state.facts)}
			/>,
		);
		expect(html).toContain("GitCafe protection is off");
		expect(html).not.toContain("<button");
		expect(html).not.toContain("Install");
	});
});
