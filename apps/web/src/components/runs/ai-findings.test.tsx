import { describe, expect, test } from "bun:test";
import type { AiReviewOutput } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { AiFindings } from "#/components/runs/ai-findings";

const output: AiReviewOutput = {
	verdict: "needs_review",
	confidence: 0.75,
	summary: "Synthetic findings for presentation tests.",
	findings: [
		{
			severity: "critical",
			file: "src/first.ts",
			line: 12,
			note: "First `literal <b>markup</b>` finding.",
		},
		{
			severity: "info",
			file: "README.md",
			note: "Second file with unmatched ` and <script>literal</script>.",
		},
		{
			severity: "warn",
			file: "src/first.ts",
			note: "Third finding with `one` then `two` and empty `` delimiters.",
		},
	],
};

const sha = "d159ecd0e52833f3b0a99e758a28b577b48bf4ea";

describe("AiFindings", () => {
	test("empty findings produce no markup", () => {
		expect(
			renderToStaticMarkup(
				<AiFindings
					output={{ ...output, findings: [] }}
					repo="o/r"
					sha={sha}
				/>,
			),
		).toBe("");
	});

	test("native lists preserve first-file encounter order and finding order within each file", () => {
		const html = renderToStaticMarkup(
			<AiFindings output={output} repo="o/r" sha={sha} />,
		);
		expect(html.match(/<ul(?:\s|>)/g)).toHaveLength(2);
		expect(html.match(/<li(?:\s|>)/g)).toHaveLength(3);
		expect(html.indexOf("first.ts")).toBeLessThan(html.indexOf("README.md"));
		expect(html.indexOf("First ")).toBeLessThan(html.indexOf("Third finding"));
		expect(html.indexOf("Third finding")).toBeLessThan(
			html.indexOf("Second file"),
		);
		expect(html).toContain(
			'class="type-label-sm text-fail-text">Critical</span>',
		);
		expect(html).toContain('class="type-label-sm text-text-1">Warning</span>');
		expect(html).toContain('class="type-label-sm text-text-2">Note</span>');
	});

	test("file and present-line links use the supplied commit and safe native external-link attributes", () => {
		const html = renderToStaticMarkup(
			<AiFindings output={output} repo="o/r" sha={sha} />,
		);
		expect(html).toContain(
			`href="https://github.com/o/r/blob/${sha}/src/first.ts"`,
		);
		expect(html).toContain(
			`href="https://github.com/o/r/blob/${sha}/src/first.ts#L12"`,
		);
		expect(html).toContain(
			`href="https://github.com/o/r/blob/${sha}/README.md"`,
		);
		expect(html.match(/<a(?:\s|>)/g)).toHaveLength(3);
		expect(html.match(/rel="noreferrer" target="_blank"/g)).toHaveLength(3);
		expect(html.match(/Line 12/g)).toHaveLength(1);
		expect(html.match(/Line /g)).toHaveLength(1);
	});

	test.each([
		null,
		"",
	])("absent commit %p leaves file paths and line labels as plain text", (commit) => {
		const html = renderToStaticMarkup(
			<AiFindings output={output} repo="o/r" sha={commit} />,
		);
		expect(html).not.toContain("<a ");
		expect(html).not.toContain("github.com");
		expect(html).toContain("first.ts");
		expect(html).toContain("README.md");
		expect(html).toMatch(/<span[^>]*>Line 12<\/span>/);
	});

	test("notes escape markup and preserve paired, unmatched and empty backticks", () => {
		const html = renderToStaticMarkup(
			<AiFindings output={output} repo="o/r" sha={null} />,
		);
		expect(html).not.toContain("<b>");
		expect(html).not.toContain("<script>");
		expect(html).toMatch(
			/<code[^>]*>literal &lt;b&gt;markup&lt;\/b&gt;<\/code>/,
		);
		expect(html).toContain(
			"unmatched ` and &lt;script&gt;literal&lt;/script&gt;",
		);
		expect(html.match(/<code(?:\s|>)/g)).toHaveLength(3);
		expect(html.indexOf(">one</code>")).toBeLessThan(
			html.indexOf(">two</code>"),
		);
		expect(html).toContain("empty `` delimiters.");
	});
});
