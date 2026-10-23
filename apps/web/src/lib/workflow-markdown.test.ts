import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "@tripwire/contracts";
import { workflowToMarkdown } from "./workflow-markdown";

/**
 * The serializer as a pure function: definition (+ custom-rule display) in,
 * markdown out. The load-bearing test is the leak fixture — a workflow that
 * HAS a real webhook url, a real discord url, and a signing secret, so a
 * regression in the never-emit-by-construction rule would show up as a leak
 * (an empty workflow would pass trivially).
 */

function makeWorkflow(
	over: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
	return {
		id: "wf-1",
		name: "test workflow",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
			{ id: "g", type: "gate", mode: "all-of" },
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "g" },
			{ id: "e3", from: "g", to: "a", when: "fail" },
		],
		...over,
	};
}

describe("workflowToMarkdown — header + built-in rules", () => {
	const md = workflowToMarkdown(DEFAULT_WORKFLOW);

	test("titles the workflow and states its id, version, node count", () => {
		expect(md).toContain("# Workflow: default gate");
		expect(md).toContain("`default@1`, v1, 8 nodes");
	});

	test("names the trigger's resolved event kinds", () => {
		expect(md).toContain("### Trigger");
		expect(md).toContain("Change request opened, Change request updated");
	});

	test("fills each built-in rule's sentence with THIS node's config", () => {
		// number + unit, percent, and string-list, resolved via formatParamValue.
		expect(md).toContain(
			"- **Account age** `account-age@1`: blocks accounts younger than 7 days",
		);
		expect(md).toContain("more than 200 files");
		expect(md).toContain(
			"blocks when more than 50% of the text is non-latin script",
		);
		expect(md).toContain(
			"blocks any change request that touches .github/workflows/**",
		);
	});

	test("a param-less rule renders name + ref only, no sentence", () => {
		expect(md).toContain("- **Crypto address** `crypto-address@1`");
		expect(md).not.toContain("crypto address** `crypto-address@1`:");
	});

	test("the gate names its meaning and its inputs", () => {
		expect(md).toContain("### Gates");
		expect(md).toContain(
			"- **All of**: Passes only when every connected check passes.",
		);
		expect(md).toContain(
			"inputs: Account age, Crypto address, Honeypot paths, Max files changed, English only",
		);
	});

	test("the action states its firing condition", () => {
		expect(md).toContain("### Actions");
		expect(md).toContain("- **Block**: when all of fails");
	});
});

describe("workflowToMarkdown — secret safety (the leak fixture)", () => {
	const leaky = makeWorkflow({
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "crypto-address@1", config: {} },
			{ id: "g", type: "gate", mode: "all-of" },
			{
				id: "hook",
				type: "action",
				action: "webhook",
				params: {
					url: "https://evil.example.com/leak-me",
					signingSecret: "supersecretsigningvalue",
				},
			},
			{
				id: "disc",
				type: "action",
				action: "discord",
				params: { url: "https://discord.com/api/webhooks/999/REALTOKEN123" },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "g" },
			{ id: "e3", from: "g", to: "hook", when: "fail" },
			{ id: "e4", from: "g", to: "disc", when: "fail" },
		],
	});
	const md = workflowToMarkdown(leaky);

	test("no webhook url, discord url, or signing secret reaches the output", () => {
		// Teeth: the values ARE in the definition, so a passing assertion is real.
		const raw = JSON.stringify(leaky);
		expect(raw).toContain("evil.example.com");
		expect(raw).toContain("REALTOKEN123");
		expect(raw).toContain("supersecretsigningvalue");

		expect(md).not.toContain("evil.example.com");
		expect(md).not.toContain("REALTOKEN123");
		expect(md).not.toContain("supersecretsigningvalue");
		// Belt and suspenders: no url of any scheme survives.
		expect(md).not.toContain("http");
	});

	test("but the FACT that a destination is set is reported", () => {
		expect(md).toContain("- **Webhook**: when all of fails, url set");
		expect(md).toContain("signing secret set");
		expect(md).toContain("- **Discord**: when all of fails, url set");
	});

	test("a redacted definition (urlSet marker, blank url) also reads as set", () => {
		const redacted = makeWorkflow({
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "g", type: "gate", mode: "all-of" },
				{
					id: "hook",
					type: "action",
					action: "webhook",
					params: {
						url: "",
						urlSet: true,
						signingSecret: "",
						signingSecretSet: true,
					},
				},
			],
			edges: [{ id: "e1", from: "g", to: "hook", when: "fail" }],
		});
		const out = workflowToMarkdown(redacted);
		expect(out).toContain("url set");
		expect(out).toContain("signing secret set");
	});

	test("an unset delivery url reads as not set", () => {
		const unset = makeWorkflow({
			nodes: [
				{ id: "g", type: "gate", mode: "all-of" },
				{ id: "hook", type: "action", action: "webhook", params: {} },
			],
			edges: [{ id: "e1", from: "g", to: "hook", when: "fail" }],
		});
		expect(workflowToMarkdown(unset)).toContain("url not set");
	});
});

describe("workflowToMarkdown — shape variants", () => {
	test("a workflow with no actions omits the Actions section", () => {
		const noActions = makeWorkflow({
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
				{ id: "g", type: "gate", mode: "all-of" },
			],
			edges: [
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "g" },
			],
		});
		const md = workflowToMarkdown(noActions);
		expect(md).not.toContain("### Actions");
		expect(md).toContain("### Rules");
	});

	test("branching edges: each action states its own firing outcome", () => {
		const branching = makeWorkflow({
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
				{ id: "g", type: "gate", mode: "all-of" },
				{ id: "block", type: "action", action: "block" },
				{ id: "ok", type: "action", action: "label" },
			],
			edges: [
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "g" },
				{ id: "e3", from: "g", to: "block", when: "fail" },
				{ id: "e4", from: "g", to: "ok", when: "pass" },
			],
		});
		const md = workflowToMarkdown(branching);
		expect(md).toContain("- **Block**: when all of fails");
		expect(md).toContain("- **Label**: when all of passes");
	});

	test("a custom rule node resolves name + sentence through the catalog", () => {
		const wf = makeWorkflow({
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "c", type: "rule", ref: "custom-forks@1", config: {} },
				{ id: "g", type: "gate", mode: "all-of" },
			],
			edges: [
				{ id: "e1", from: "t", to: "c" },
				{ id: "e2", from: "c", to: "g" },
			],
		});
		const md = workflowToMarkdown(wf, [
			{
				ref: "custom-forks@1",
				name: "fork spam",
				description:
					"flag when fork rate in the last 24 hours is over 10, as a high signal",
			},
		]);
		expect(md).toContain(
			"- **fork spam** `custom-forks@1`: flag when fork rate in the last 24 hours is over 10, as a high signal",
		);
	});

	test("an unknown custom ref reads as a custom rule, ref kept in code", () => {
		const wf = makeWorkflow({
			nodes: [
				{ id: "c", type: "rule", ref: "custom-mystery@1", config: {} },
				{ id: "g", type: "gate", mode: "all-of" },
			],
			edges: [{ id: "e1", from: "c", to: "g" }],
		});
		const md = workflowToMarkdown(wf);
		expect(md).toContain("- **Custom rule** `custom-mystery@1`");
	});
});

describe("workflowToMarkdown — request-review names who is asked", () => {
	test("lists the people and teams on the action", () => {
		const md = workflowToMarkdown(
			makeWorkflow({
				nodes: [
					{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
					{
						id: "a",
						type: "action",
						action: "request-review",
						params: {
							reviewers: ["octocat", { id: 2, login: "hubot" }],
							teamReviewers: ["core"],
						},
					},
				],
				edges: [{ id: "e1", from: "t", to: "a" }],
			}),
		);
		expect(md).toContain("people: octocat, hubot");
		expect(md).toContain("teams: core");
	});
});
