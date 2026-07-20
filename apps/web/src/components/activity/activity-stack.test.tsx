import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityGroup } from "#/lib/activity.functions";
import { ActivityStack } from "./activity-stack";

/**
 * Static-markup render states (the rule-card technique — no interaction layer
 * exists in this repo's UI tests). The re-run affordance: admins see the armed
 * button in the destructive register; members see nothing.
 */

const qc = new QueryClient();
const render = (node: ReactNode): string =>
	renderToStaticMarkup(
		<QueryClientProvider client={qc}>{node}</QueryClientProvider>,
	);

const group: ActivityGroup = {
	repoFullName: "acme/web",
	subjectNumber: 7,
	title: "add feature",
	url: "https://github.com/acme/web/pull/7",
	actor: { login: "octocat", avatarUrl: null },
	currentVerdict: "pass",
	currentRunId: null,
	latestActivityAt: "2026-07-20T00:00:00.000Z",
	eventCount: 1,
	timeline: [],
};

describe("ActivityStack re-run affordance", () => {
	test("admin scope shows the re-run button in the destructive register", () => {
		const html = render(
			<ActivityStack group={group} rerun={{ org: "acme", repo: "web" }} />,
		);
		expect(html).toContain("re-run rules");
		expect(html).toContain("bg-red-500/10");
		// The confirm step is not pre-rendered — it arms on click.
		expect(html).not.toContain("confirm re-run");
	});

	test("members (no rerun scope) see no action", () => {
		const html = render(<ActivityStack group={group} />);
		expect(html).not.toContain("re-run rules");
	});
});
