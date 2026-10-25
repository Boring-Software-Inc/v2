import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { SAMPLE_RUN } from "#/components/responses/sample-run";
import { PassedGroup } from "#/components/runs/branch-card";
import { RunChainView } from "#/components/runs/run-chain";
import { toPublicRunView } from "#/lib/run-access";
import { buildRunChain, type ChainBranch } from "#/lib/run-chain";
import type { RunView } from "#/lib/runs.functions";

const WITH_REVIEW: RunView = {
	...SAMPLE_RUN,
	completedAt: "2026-10-21T10:15:00.700Z",
	reviews: [
		{
			workflowId: null,
			state: "open",
			degraded: false,
			openedAt: "2026-10-21T10:15:00.000Z",
			decidedAt: null,
			decidedBy: null,
		},
	],
};

function render(run: RunView, level: number): string {
	const view = toPublicRunView(run, level);
	return renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<RunChainView
				chain={buildRunChain(view)}
				context={{
					level,
					maintainer: false,
					repo: view.repoFullName,
					sha: view.headSha,
				}}
			/>
		</QueryClientProvider>,
	);
}

describe("run chain outcome node", () => {
	test("shows its offset from the event", () => {
		expect(render(WITH_REVIEW, 8)).toContain("+2.7s");
	});

	test("shows each clock time with its zone", () => {
		expect(render(WITH_REVIEW, 8)).toMatch(/\d{2}:\d{2}:\d{2} UTC/);
	});

	test("shows the offset of a run still waiting for review", () => {
		const paused: RunView = {
			...WITH_REVIEW,
			status: "paused",
			verdict: "needs_review",
			completedAt: null,
		};
		expect(render(paused, 8)).toContain("+2s");
	});

	test("keeps human review open through level 7 and hides it at level 8", () => {
		expect(render(WITH_REVIEW, 6)).toContain("Human review open");
		expect(render(WITH_REVIEW, 7)).toContain("Human review open");
		expect(render(WITH_REVIEW, 8)).not.toContain("Human review open");
	});
});

describe("passed workflows group", () => {
	test("its button reads the count and the noun with a space", () => {
		const branch = (id: string): ChainBranch => ({
			id,
			name: `Workflow ${id}`,
			isRules: false,
			form: "row",
			passed: [],
			flagged: [],
			pending: [],
			exceptions: [],
			outcome: null,
		});
		const markup = renderToString(
			<PassedGroup
				branches={[branch("a"), branch("b")]}
				context={{ level: 8, maintainer: false, repo: "o/r", sha: null }}
			/>,
		);
		expect(markup).toContain(">2 workflows passed<");
	});
});

describe("a passing AI review in the passed list", () => {
	const SUMMARY = "It adds a donation address with no related code change.";
	const passingAi: RunView = {
		...SAMPLE_RUN,
		steps: SAMPLE_RUN.steps.map((step) =>
			step.ruleRef === "ai-review@2" ? { ...step, status: "pass" } : step,
		),
	};

	test("shows its summary next to the other passed rules", () => {
		expect(render(passingAi, 0)).toContain(SUMMARY);
		expect(render(passingAi, 3)).toContain(SUMMARY);
	});

	test("hides it where the repo hides AI summaries", () => {
		expect(render(passingAi, 4)).not.toContain(SUMMARY);
	});
});
