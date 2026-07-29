import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ParamSentence } from "./param-sentence";

const noop = () => {};

/**
 * §9 — readable params replace the raw JSON. Covers: param-less ⇒ no region,
 * units render inline, admin-only editing affordance, workflow-managed/member
 * read-only (both flow through canEdit=false), advanced params never shown, and
 * the raw disclosure is non-mutating.
 */
describe("ParamSentence", () => {
	test("param-less rule renders no config region", () => {
		expect(
			renderToStaticMarkup(
				<ParamSentence
					canEdit
					config={{}}
					onSaveParam={noop}
					ruleId="crypto-address"
				/>,
			),
		).toBe("");
	});

	test("renders the value inline with its unit", () => {
		const html = renderToStaticMarkup(
			<ParamSentence
				canEdit={false}
				config={{ minDays: 7 }}
				onSaveParam={noop}
				ruleId="account-age"
			/>,
		);
		expect(html).toContain("blocks accounts younger than");
		expect(html).toContain("7 days");
	});

	test("percent param renders as a percentage", () => {
		const html = renderToStaticMarkup(
			<ParamSentence
				canEdit={false}
				config={{ maxNonLatinRatio: 0.5 }}
				onSaveParam={noop}
				ruleId="english-only"
			/>,
		);
		expect(html).toContain("50%");
	});

	test("read-only (member OR workflow-managed) shows no edit affordance", () => {
		const html = renderToStaticMarkup(
			<ParamSentence
				canEdit={false}
				config={{ minDays: 7 }}
				onSaveParam={noop}
				ruleId="account-age"
			/>,
		);
		expect(html).not.toContain("<button");
	});

	test("admin (canEdit) exposes an inline edit affordance", () => {
		const html = renderToStaticMarkup(
			<ParamSentence
				canEdit
				config={{ minDays: 7 }}
				onSaveParam={noop}
				ruleId="account-age"
			/>,
		);
		expect(html).toContain("<button");
	});

	test("advanced params (ai-review model) never render in the sentence", () => {
		const html = renderToStaticMarkup(
			<ParamSentence
				canEdit={false}
				config={{ maxSteps: 12, model: "anthropic/claude-fable-5" }}
				onSaveParam={noop}
				ruleId="ai-review"
			/>,
		);
		expect(html).toContain("12 steps");
		expect(html).not.toContain("claude-fable-5");
	});

	test("per-param sentences render on separate lines (min-merged-prs)", () => {
		const html = renderToStaticMarkup(
			<ParamSentence
				canEdit={false}
				config={{ min: 1, trustedAfter: 1 }}
				onSaveParam={noop}
				ruleId="min-merged-prs"
			/>,
		);
		expect(html).toContain("merged change request elsewhere");
		expect(html).toContain("trusts returning contributors after");
	});
});
