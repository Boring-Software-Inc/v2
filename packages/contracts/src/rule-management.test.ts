import { describe, expect, test } from "bun:test";
import { resolveRuleManagement } from "./rules.ts";
import type { WorkflowDefinition } from "./workflow.ts";

/** A minimal enabled workflow owning the given rule refs. */
function workflow(id: string, refs: string[]): WorkflowDefinition {
	return {
		id,
		name: id,
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			...refs.map((ref, i) => ({
				id: `r${i}`,
				type: "rule" as const,
				ref,
				config: { marker: ref },
			})),
		],
		edges: [],
	};
}

/**
 * §6 — workflows compose with standalone rules. A rule's state derives from
 * whether its id is a node in an enabled workflow, per-rule, never a
 * repo-level boolean; a rule OUTSIDE every workflow stays standalone and
 * keeps running on its own toggle.
 */
describe("resolveRuleManagement", () => {
	test("no enabled workflow ⇒ standalone", () => {
		expect(resolveRuleManagement("account-age", [])).toEqual({
			state: "standalone",
			workflowId: null,
			managedConfig: null,
		});
	});

	test("rule IS a node in an enabled workflow ⇒ managed, with the NODE's config", () => {
		const wf = workflow("wf-1", ["account-age@1"]);
		expect(resolveRuleManagement("account-age", [wf])).toEqual({
			state: "managed",
			workflowId: "wf-1",
			managedConfig: { marker: "account-age@1" },
		});
	});

	test("version-agnostic match (node @2, rule id matches)", () => {
		const wf = workflow("wf-1", ["min-merged-prs@2"]);
		expect(resolveRuleManagement("min-merged-prs", [wf]).state).toBe("managed");
	});

	test("workflow enabled but rule absent ⇒ standalone (it still runs on its own toggle)", () => {
		const wf = workflow("wf-1", ["account-age@1"]);
		expect(resolveRuleManagement("crypto-address", [wf])).toEqual({
			state: "standalone",
			workflowId: null,
			managedConfig: null,
		});
	});

	test("the founder bug: a workflow with ONLY account-age owns account-age, and ONLY account-age", () => {
		const wfs = [workflow("wf-1", ["account-age@1"])];
		expect(resolveRuleManagement("account-age", wfs).state).toBe("managed");
		expect(resolveRuleManagement("honeypot", wfs).state).toBe("standalone");
		expect(resolveRuleManagement("crypto-address", wfs).state).toBe(
			"standalone",
		);
	});

	test("owning workflow wins across multiple enabled workflows", () => {
		const wfs = [
			workflow("wf-1", ["account-age@1"]),
			workflow("wf-2", ["honeypot@1"]),
		];
		expect(resolveRuleManagement("honeypot", wfs).workflowId).toBe("wf-2");
	});
});
