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
	forgeBlockReason: null,
	unavailableReason: null,
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
	blockingWorkflows: [],
	...over,
});

const base = { org: "o", repo: "r", canEdit: true };

const ENABLE_DISABLED =
	/<button(?=[^>]*\sdisabled="")(?=[^>]*aria-label="Enable rule account age")[^>]*>/;

/**
 * §6 per-rule management — workflows compose with standalone rules, so a card
 * is either standalone (its own toggle runs) or managed (a workflow node).
 * Managed fixtures use workflowId:null so the router-bound <Link> is guarded
 * out (link labels + route are locked by the source assertion below).
 */
describe("RuleCard management states", () => {
	test("standalone: toggle present, no management tag", () => {
		const html = render(<RuleCard {...base} rule={rule()} />);
		expect(html).toContain('aria-label="Disable rule account age"');
		expect(html).toContain(">Disable rule<");
		expect(html).not.toContain('role="switch"');
		expect(html).not.toContain("In workflow");
		expect(html).not.toContain(">off<");
	});

	test("managed: no toggle, 'in workflow' tag, and shows the NODE's config (not the stale row)", () => {
		const html = render(
			<RuleCard
				{...base}
				rule={rule({ management: "managed", config: { minDays: 14 } })}
			/>,
		);
		expect(html).toContain("In workflow");
		expect(html).not.toContain("Disable rule");
		expect(html).not.toContain("Enable rule");
		// what actually runs is the workflow node's 14 days, not the card's old 7
		expect(html).toContain("14 days");
	});

	test("held prompt shows only in standalone (managed drives from the node, not the row)", () => {
		const heldStandalone = render(
			<RuleCard {...base} rule={rule({ held: true })} />,
		);
		expect(heldStandalone).toContain("New version waiting");
		const heldManaged = render(
			<RuleCard {...base} rule={rule({ held: true, management: "managed" })} />,
		);
		expect(heldManaged).not.toContain("New version waiting");
	});

	test("the footer states the effect and the last 24 hours of activity", () => {
		const fired = render(<RuleCard {...base} rule={rule({ matches24h: 3 })} />);
		expect(fired).toContain("Blocks");
		expect(fired).toContain("matches, last 24 h");
		expect(
			render(<RuleCard {...base} rule={rule({ matches24h: 1 })} />),
		).toContain("match, last 24 h");
		expect(
			render(<RuleCard {...base} rule={rule({ matches24h: 0 })} />),
		).toContain("No matches, last 24 h");
		expect(
			render(<RuleCard {...base} rule={rule({ enabled: false })} />),
		).toContain(">Off<");
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
		expect(html).toContain("Enable rule");
		expect(html).toContain("costs tokens");
	});

	test("workflow deep-links and labels are wired (source-locked, router-free)", () => {
		const src = readFileSync(join(import.meta.dir, "rule-card.tsx"), "utf8");
		expect(src).toContain("Edit in workflow");
		expect(src).toContain("/$org/$repo/workflows/$workflowId");
	});
});

/**
 * A rule the forge cannot feed must be INERT, not merely annotated. Leaving the
 * toggle live lets a maintainer arm account-age on a gitlab repo and believe
 * contributions are age-gated when the rule can never fire.
 */
describe("RuleCard forge support", () => {
	test("forge-blocked: says why in plain language and the toggle is disabled", () => {
		const html = render(
			<RuleCard
				{...base}
				rule={rule({
					enabled: false,
					forgeBlockReason: "not usable with gitlab",
				})}
			/>,
		);
		expect(html).toContain("not usable with gitlab");
		expect(html).toMatch(ENABLE_DISABLED);
	});

	test("forge-blocked: an opt-in rule's enable button is disabled", () => {
		const html = render(
			<RuleCard
				{...base}
				rule={rule({
					enabled: false,
					optIn: true,
					forgeBlockReason: "not usable with gitlab",
				})}
			/>,
		);
		expect(html).toMatch(ENABLE_DISABLED);
	});

	test("usable rule is untouched — no reason chip, toggle live", () => {
		const html = render(<RuleCard {...base} rule={rule()} />);
		expect(html).not.toContain("not usable with");
		expect(html).toContain(">Disable rule<");
		expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
	});
});

describe("RuleCard when AI review is out of credits", () => {
	const aiRule = (over: Partial<RuleConfigView>) =>
		rule({
			ruleId: "ai-review",
			name: "AI review",
			optIn: true,
			config: { maxSteps: 12 },
			defaultConfig: { maxSteps: 12 },
			unavailableReason: "Out of AI credits",
			...over,
		});
	const AI_ENABLE_DISABLED =
		/<button(?=[^>]*\sdisabled="")(?=[^>]*aria-label="Enable rule AI review")[^>]*>/;

	test("off: it can't turn on, says why, and the enable button is disabled", () => {
		const html = render(
			<RuleCard {...base} rule={aiRule({ enabled: false })} />,
		);
		expect(html).toContain("Can&#x27;t turn on");
		expect(html).toContain("Out of AI credits");
		expect(html).toMatch(AI_ENABLE_DISABLED);
	});

	test("on: it reads Can't run and can still be turned off", () => {
		const html = render(
			<RuleCard {...base} rule={aiRule({ enabled: true })} />,
		);
		expect(html).toContain("Can&#x27;t run");
		expect(html).toContain("Out of AI credits");
		expect(html).toContain(">Disable rule<");
		expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
	});

	test("in a workflow: it reads Can't run", () => {
		const html = render(
			<RuleCard
				{...base}
				rule={aiRule({ enabled: true, management: "managed" })}
			/>,
		);
		expect(html).toContain("Can&#x27;t run");
	});
});
