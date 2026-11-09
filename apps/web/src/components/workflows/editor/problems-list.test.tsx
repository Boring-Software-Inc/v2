import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Problem } from "#/components/workflows/editor/node-issues";
import {
	ProblemRows,
	ProblemsButton,
	severityStatus,
} from "#/components/workflows/editor/problems-list";

const problems: Problem[] = [
	{
		key: "warning",
		rule: "no-action",
		severity: "warning",
		step: "Trigger 2",
		message: "Add an action after the trigger.",
		edgeId: "edge",
		fixes: [
			{ label: "Add trigger", edit: { type: "add-trigger" } },
			{ label: "Remove edge", edit: { type: "remove-edge", edgeId: "edge" } },
			{
				label: "Delete node",
				edit: { type: "delete-node", nodeId: "trigger" },
			},
		],
	},
	{
		key: "error",
		rule: "no-action",
		severity: "error",
		step: "Trigger",
		message: "Add an action after the trigger.",
		nodeId: "trigger",
		edgeId: "edge",
		fixes: [
			{
				label: "Add next step",
				intent: { type: "add-next-step", nodeId: "trigger", port: "event" },
			},
			{ label: "Hidden error fix", edit: { type: "add-trigger" } },
		],
	},
];

test("problem rows retain severity sections, compact native headings and fix limits", () => {
	const html = renderToStaticMarkup(
		<ProblemRows
			problems={problems}
			onFix={() => undefined}
			onReveal={() => undefined}
		/>,
	);
	expect(
		Array.from(html.matchAll(/<h3\b[^>]*>(.*?)<\/h3>/g), (match) => match[1]),
	).toEqual(["Fix these to turn it on", "Suggestions"]);
	expect(html).toContain(
		'<h3 data-layout-role="workflow-problem-section-heading">',
	);
	expect(html).toContain(
		'<span data-type-role="label" data-layout-role="workflow-problem-step">Trigger</span>',
	);
	expect(html).toContain('aria-label="Show Trigger"');
	expect(html).toContain('aria-label="Show Trigger 2"');
	for (const label of ["Add next step", "Add trigger", "Remove edge"])
		expect(html).toContain(label);
	for (const label of ["Hidden error fix", "Delete node"])
		expect(html).not.toContain(label);
	expect(severityStatus(problems)).toBe("fail");
	expect(severityStatus(problems.slice(0, 1))).toBe("warn");
});

test("problem rows omit fixes and reveal controls when callbacks are absent", () => {
	const html = renderToStaticMarkup(<ProblemRows problems={problems} />);
	expect(html).not.toContain("<button");
	expect(html).toContain("Trigger 2");
	expect(html).toContain("Add an action after the trigger.");
});

test("empty problems have neither sections nor a controlled popover trigger", () => {
	expect(renderToStaticMarkup(<ProblemRows problems={[]} />)).not.toContain(
		"<section",
	);
	expect(
		renderToStaticMarkup(
			<ProblemsButton
				problems={[]}
				open
				onOpenChange={() => undefined}
				onFix={() => undefined}
				onReveal={() => undefined}
			/>,
		),
	).toBe("");
});

test("problem text is escaped without changing its contents", () => {
	const html = renderToStaticMarkup(
		<ProblemRows
			problems={problems.map((problem) => ({
				...problem,
				step: "<b>Ωmega</b>",
				message: "مرحبا & <script>alert(1)</script>",
			}))}
		/>,
	);
	expect(html).toContain("&lt;b&gt;Ωmega&lt;/b&gt;");
	expect(html).toContain("مرحبا &amp; &lt;script&gt;alert(1)&lt;/script&gt;");
	expect(html).not.toContain("<script>");
});
