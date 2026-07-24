import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveQueueProvider } from "#/components/save-queue";
import type { RuleConfigView } from "#/lib/rules.functions";
import { RuleCard } from "./rule-card";

const qc = new QueryClient();
// Empty savedValues: the card reads pending-or-saved and falls back to the
// view's own fields, so static renders need no per-rule baseline. The nav
// guard lives on the bar (not rendered here), keeping this router-free.
function render(node: ReactNode): string {
	return renderToStaticMarkup(
		<QueryClientProvider client={qc}>
			<SaveQueueProvider commit={async () => ({ ok: true })} savedValues={{}}>
				{node}
			</SaveQueueProvider>
		</QueryClientProvider>,
	);
}

const rule = (over: Partial<RuleConfigView> = {}): RuleConfigView => ({
	ruleId: "account-age",
	version: 1,
	held: false,
	changeNote: null,
	name: "account age",
	blurb: "the contributor's account must be old enough.",
	enabled: true,
	config: { minDays: 7 },
	defaultConfig: { minDays: 7 },
	management: "standalone",
	workflowId: null,
	optIn: false,
	matches24h: 0,
	trend: [],
	source: "built-in",
	sentence: null,
	severity: null,
	...over,
});

const base = { org: "o", repo: "r", canEdit: true };

/**
 * §6 per-rule management — workflows compose with standalone rules, so a card
 * is either standalone (its own toggle runs) or managed (a workflow node).
 * Managed fixtures use workflowId:null so the router-bound <Link> is guarded
 * out (link labels + route are locked by the source assertion below).
 */
describe("RuleCard management states", () => {
	test("standalone: toggle present, no management tag", () => {
		const html = render(<RuleCard {...base} rule={rule()} />);
		expect(html).toContain('role="switch"');
		expect(html).not.toContain("in workflow");
		expect(html).not.toContain(">off<");
	});

	test("managed: no toggle, 'in workflow' tag, and shows the NODE's config (not the stale row)", () => {
		const html = render(
			<RuleCard
				{...base}
				rule={rule({ management: "managed", config: { minDays: 14 } })}
			/>,
		);
		expect(html).toContain("in workflow");
		expect(html).not.toContain('role="switch"');
		// what actually runs is the workflow node's 14 days, not the card's old 7
		expect(html).toContain("14 days");
	});

	test("held prompt shows only in standalone (managed drives from the node, not the row)", () => {
		const heldStandalone = render(
			<RuleCard {...base} rule={rule({ held: true })} />,
		);
		expect(heldStandalone).toContain("update held");
		const heldManaged = render(
			<RuleCard {...base} rule={rule({ held: true, management: "managed" })} />,
		);
		expect(heldManaged).not.toContain("update held");
	});

	test("the 24h count reddens only when blocks actually fired", () => {
		expect(
			render(<RuleCard {...base} rule={rule({ matches24h: 3 })} />),
		).toContain("text-red-600");
		expect(
			render(<RuleCard {...base} rule={rule({ matches24h: 0 })} />),
		).not.toContain("text-red-600");
	});

	test("an opt-in-off standalone rule keeps a DISTINCT enable offer", () => {
		const html = render(
			<RuleCard
				{...base}
				rule={rule({
					ruleId: "ai-review",
					name: "ai review",
					optIn: true,
					enabled: false,
					blurb: "off until you turn it on — ai review costs tokens.",
					config: { maxSteps: 12 },
					defaultConfig: { maxSteps: 12 },
				})}
			/>,
		);
		expect(html).toContain("enable");
		expect(html).toContain("costs tokens");
	});

	test("workflow deep-links and labels are wired (source-locked, router-free)", () => {
		const src = readFileSync(join(import.meta.dir, "rule-card.tsx"), "utf8");
		expect(src).toContain("edit in workflow →");
		expect(src).toContain("/$org/$repo/workflows/$workflowId");
	});
});
