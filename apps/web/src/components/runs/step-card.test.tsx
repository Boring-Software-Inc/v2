import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunStepView } from "#/lib/runs.functions";
import { StepCard } from "./step-card";

function moderationStep(decision: string): RunStepView {
	return {
		id: "s1",
		nodeId: "default@1:mod:resume",
		nodeKind: "action",
		ruleRef: null,
		label: "send-to-moderation",
		status: "pass",
		evidence: null,
		output: { action: "send-to-moderation", decision },
		durationMs: 3,
		startedAt: "2026-10-20T00:00:00.000Z",
	};
}

function render(step: RunStepView): string {
	return renderToStaticMarkup(
		<StepCard maintainer repo="o/r" sha={null} step={step} />,
	);
}

describe("StepCard maintainer decision", () => {
	test("an approve reads as approved by a maintainer", () => {
		const html = render(moderationStep("approve"));
		expect(html).toContain("Approved by a maintainer");
		expect(html).not.toContain("Send-to-moderation");
	});

	test("a deny reads as blocked by a maintainer", () => {
		const html = render(moderationStep("deny"));
		expect(html).toContain("Blocked by a maintainer");
		expect(html).not.toContain("denied");
	});

	test("an unknown decision falls back to the plain step row", () => {
		const html = render(moderationStep("maybe"));
		expect(html).toContain("Send-to-moderation");
	});
});
