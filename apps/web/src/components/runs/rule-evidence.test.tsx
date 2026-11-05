import { describe, expect, test } from "bun:test";
import { aiReviewOutputSchema, aiReviewTraceSchema } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { RuleEvidence } from "#/components/runs/rule-evidence";
import type { JsonValue, RunStepView } from "#/lib/runs.functions";

const PRIVATE_TRACE = "PRIVATE_TRACE_CANARY <b>literal trace</b>";
const PRIVATE_RAW = "PRIVATE_RAW_CANARY";
const output = aiReviewOutputSchema.parse({
	verdict: "needs_review",
	confidence: 0.75,
	summary: "Local typed UI prop data",
	findings: [
		{
			severity: "warn",
			file: "src/Ωmega-مرحبا.ts",
			line: 12,
			note: "Inspect `literal <b>markup</b>`.",
		},
	],
});
const trace = aiReviewTraceSchema.parse({
	model: "anthropic/claude-haiku-4.5",
	stepsUsed: 1,
	maxSteps: 12,
	trimmed: false,
	usage: { input: 1200, output: 80, cached: null },
	steps: [{ type: "reasoning", excerpt: PRIVATE_TRACE, truncated: false }],
});

function renderEvidence(
	ruleRef: string | null,
	evidence: JsonValue,
	maintainer = false,
): string {
	const step: RunStepView = {
		id: "local-ui-step",
		nodeId: "local-ui-node",
		nodeKind: "rule",
		ruleRef,
		status: "passed",
		evidence,
		output: null,
		durationMs: 25,
		startedAt: "2026-10-27T12:00:00Z",
	};
	return renderToStaticMarkup(
		<RuleEvidence
			maintainer={maintainer}
			repo="local/ui"
			sha={null}
			step={step}
		/>,
	);
}

describe("RuleEvidence", () => {
	test("public findings render while all private trace and raw data are absent from the DOM", () => {
		const html = renderEvidence("ai-review@2", {
			output,
			trace,
			private: PRIVATE_RAW,
		});
		expect(html).toContain("1 finding");
		expect(html).toContain("Inspect ");
		expect(html).toContain("literal &lt;b&gt;markup&lt;/b&gt;</code>");
		expect(html).not.toContain("<b>");
		expect(html).not.toContain("PRIVATE_TRACE_CANARY");
		expect(html).not.toContain(PRIVATE_RAW);
		expect(html).not.toContain("anthropic/claude-haiku-4.5");
		expect(html).not.toContain("Raw evidence");
		expect(html).not.toContain("tokens in");
	});

	test("maintainers retain trace, findings, and nested raw trigger with original labels", async () => {
		const html = renderEvidence("ai-review@2", { output, trace }, true);
		expect(html).toContain("Trace, 1 finding");
		expect(html).toContain("Raw evidence");
		expect(html).toContain("1,200 tokens in");
		expect(html).toContain("80 out");
		expect(html).toContain("25ms");
		expect(html).toContain(
			"PRIVATE_TRACE_CANARY &lt;b&gt;literal trace&lt;/b&gt;",
		);
		expect(html).not.toContain("<b>");
		const panels: { tag: string; hidden: string | null }[] = [];
		const triggers: { tag: string; expanded: string | null }[] = [];
		await new HTMLRewriter()
			.on(
				'[data-layout-role="rule-evidence"] > [data-slot="collapsible-content"]',
				{
					element(element) {
						panels.push({
							tag: element.tagName,
							hidden: element.getAttribute("hidden"),
						});
					},
				},
			)
			.on(
				'[data-layout-role="rule-evidence"] > [data-slot="collapsible-trigger"]',
				{
					element(element) {
						triggers.push({
							tag: element.tagName,
							expanded: element.getAttribute("aria-expanded"),
						});
					},
				},
			)
			.transform(new Response(html))
			.text();
		expect(panels).toEqual([{ tag: "div", hidden: "" }]);
		expect(triggers).toEqual([{ tag: "button", expanded: "false" }]);
	});

	test("trace-only evidence is absent publicly, retained for maintainers", () => {
		expect(renderEvidence("ai-review@2", { output: null, trace })).toBe("");
		const html = renderEvidence("ai-review@2", { output: null, trace }, true);
		expect(html).toContain(">Trace</span>");
		expect(html).toContain("PRIVATE_TRACE_CANARY");
		expect(html).not.toContain("finding</span>");
	});

	test("empty findings and absent trace do not create a public detail", () => {
		const empty = aiReviewOutputSchema.parse({ ...output, findings: [] });
		expect(renderEvidence("ai-review@2", { output: empty, trace: null })).toBe(
			"",
		);
		const html = renderEvidence(
			"ai-review@2",
			{ output: empty, trace: null },
			true,
		);
		expect(html).toContain('role="tree"');
		expect(html).toContain('aria-label="Raw evidence"');
		expect(html).not.toContain("0 findings");
	});

	test("malformed AI output or trace is caught independently without changing fallback precedence", () => {
		const withTrace = renderEvidence(
			"ai-review@2",
			{ output: { findings: "bad" }, trace },
			true,
		);
		expect(withTrace).toContain(">Trace</span>");
		expect(withTrace).toContain("PRIVATE_TRACE_CANARY");
		const withFindings = renderEvidence("ai-review@2", {
			output,
			trace: { usage: "bad" },
		});
		expect(withFindings).toContain("1 finding");
		expect(withFindings).not.toContain("tokens in");
		expect(renderEvidence("ai-review@2", { output: "bad", trace: false })).toBe(
			"",
		);
	});

	test("honeypot and crypto labels preserve singular/plural, order and native named lists", () => {
		const oneFile = renderEvidence("honeypot@9", { touched: ["a.ts"] });
		expect(oneFile).toContain("Evidence, 1 file");
		expect(oneFile).toContain('aria-label="Protected files touched"');
		expect(oneFile).not.toContain("Raw evidence");
		expect(oneFile).not.toContain("<a ");
		const twoFiles = renderEvidence("honeypot@1", {
			touched: ["a.ts", "b.ts"],
		});
		expect(twoFiles).toContain("Evidence, 2 files");
		expect(twoFiles.indexOf("a.ts")).toBeLessThan(twoFiles.indexOf("b.ts"));
		const matches = [{ value: "0x<literal>", location: "body" }];
		expect(renderEvidence("crypto-address@1", { matches })).toContain(
			"Evidence, 1 match",
		);
		const twoMatches = renderEvidence("crypto-address@1", {
			matches: [...matches, { value: "second", location: "title" }],
		});
		expect(twoMatches).toContain("Evidence, 2 matches");
		expect(twoMatches).toContain('aria-label="Matched addresses"');
		expect(twoMatches).toContain("0x&lt;literal&gt;");
		expect(twoMatches.indexOf("0x&lt;literal&gt;")).toBeLessThan(
			twoMatches.indexOf("second"),
		);
	});

	test("envelopes use inner evidence, even null, rather than outer extras", () => {
		const envelope = {
			evidence: { touched: ["inner.ts"] },
			touched: ["OUTER_CANARY.ts"],
		};
		const html = renderEvidence("honeypot@1", envelope);
		expect(html).toContain("inner.ts");
		expect(html).not.toContain("OUTER_CANARY");
		expect(
			renderEvidence(
				"honeypot@1",
				{ evidence: null, touched: ["outer.ts"] },
				true,
			),
		).toBe("");
		expect(
			renderEvidence("ai-review@2", { evidence: { output, trace } }),
		).not.toContain("PRIVATE_TRACE_CANARY");
	});

	test.each<[JsonValue]>([
		[null],
		[false],
		[0],
		["draft"],
		[[]],
		[{}],
		[{ touched: [7] }],
		[{ touched: "bad" }],
		[{ touched: [] }],
	])("honeypot malformed or empty draft %j produces no public detail", (evidence) => {
		expect(renderEvidence("honeypot@1", evidence)).toBe("");
	});

	test.each<[JsonValue]>([
		[{ matches: [] }],
		[{ matches: "bad" }],
		[
			{
				matches: [
					{ value: "valid", location: "body" },
					{ value: 7, location: "body" },
				],
			},
		],
	])("crypto malformed or empty draft %j catches the whole matches object", (evidence) => {
		expect(renderEvidence("crypto-address@1", evidence)).toBe("");
	});

	test("unknown/null refs and malformed known evidence retain maintainer raw fallback only", () => {
		for (const ruleRef of [
			"unknown@1",
			null,
			"honeypot@1",
			"crypto-address@1",
			"ai-review@2",
		]) {
			const evidence = { private: PRIVATE_RAW, literal: "<b>raw</b>" };
			expect(renderEvidence(ruleRef, evidence)).toBe("");
			const html = renderEvidence(ruleRef, evidence, true);
			expect(html).toContain('role="tree"');
			expect(html).toContain('aria-label="Raw evidence"');
			expect(html).toContain(PRIVATE_RAW);
			expect(html).not.toContain("<b>raw</b>");
		}
		expect(renderEvidence("unknown@1", null, true)).toBe("");
	});
});
