import { describe, expect, test } from "bun:test";
import type { RulePreview } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuleConfigView } from "#/lib/rules.functions";
import { RuleLibrary } from "./rule-library";
import { rulesCaught } from "./rule-packs";

const rule = (over: Partial<RuleConfigView> = {}): RuleConfigView => ({
	ruleId: "account-age",
	forgeBlockReason: null,
	unavailableReason: null,
	version: 1,
	held: false,
	changeNote: null,
	name: "Account age",
	blurb: "the contributor's account must be old enough.",
	enabled: false,
	config: { minDays: 7 },
	defaultConfig: { minDays: 7 },
	management: "standalone",
	workflowId: null,
	optIn: false,
	matches24h: 0,
	trend: [],
	source: "built-in",
	sentence: null,
	blockingWorkflows: [],
	...over,
});

const preview: RulePreview = {
	windowDays: 30,
	changeRequests: 4,
	rules: [
		{ ruleId: "account-age", caught: [1, 2], examples: [] },
		{ ruleId: "honeypot", caught: [3], examples: [] },
	],
	recent: [],
};

describe("rulesCaught", () => {
	test("counts rules that run at their default settings", () => {
		expect(rulesCaught(preview, [rule()], ["account-age"])).toBe(2);
	});

	test("a tuned rule gets no count, because the preview used the defaults", () => {
		const tuned = rule({ config: { minDays: 30 } });
		expect(rulesCaught(preview, [tuned], ["account-age"])).toBeNull();
		expect(
			rulesCaught(
				preview,
				[tuned, rule({ ruleId: "honeypot" })],
				["account-age", "honeypot"],
			),
		).toBeNull();
	});
});

describe("RuleLibrary", () => {
	const render = (rules: RuleConfigView[], mostUsed: string[]) =>
		renderToStaticMarkup(
			<RuleLibrary
				canEdit
				mostUsed={mostUsed}
				onTurnOn={() => undefined}
				pending={null}
				preview={null}
				repoName="app"
				rules={rules}
			/>,
		);

	test("shows the settings that turning the rule on will run", () => {
		const html = render([rule({ config: { minDays: 30 } })], []);
		expect(html).toContain("30");
		expect(html).not.toContain(">7<");
	});

	test("lists every off rule even without a ranking", () => {
		const html = render(
			[
				rule(),
				rule({ ruleId: "honeypot", name: "Honeypot paths" }),
				rule({ ruleId: "max-files-changed", name: "Max files changed" }),
			],
			[],
		);
		expect(html).toContain("Most used");
		expect(html).toContain("Honeypot paths");
		expect(html).toContain("Max files changed");
	});
});
