import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { SAMPLE_RUN } from "#/components/responses/sample-run";
import { RunChainView } from "#/components/runs/run-chain";
import { toPublicRunView } from "#/lib/run-access";
import { buildRunChain } from "#/lib/run-chain";
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
