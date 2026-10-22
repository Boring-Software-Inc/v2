import { describe, expect, test } from "bun:test";
import {
	validateWorkflow,
	validateWorkflowForEnable,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import {
	brokenWorkflowDefinition,
	liveWorkflowDefinition,
} from "./seed-scenarios.ts";

function issueMessages(definition: WorkflowDefinition): string[] {
	const result = validateWorkflowForEnable(definition);
	return result.valid ? [] : result.issues.map((issue) => issue.message);
}

describe("demo scenario workflows", () => {
	test("the live workflow passes enable-time validation", () => {
		expect(issueMessages(liveWorkflowDefinition())).toEqual([]);
	});

	test("the broken workflow fails on its wiring", () => {
		const messages = issueMessages(brokenWorkflowDefinition());
		expect(messages).toContainEqual(
			expect.stringContaining("takes rule results, not events"),
		);
		expect(messages).toContainEqual(
			expect.stringContaining("takes only Passes"),
		);
	});

	test("the broken workflow also asks nobody to review", () => {
		const broken = brokenWorkflowDefinition();
		const rewired: WorkflowDefinition = {
			...broken,
			edges: [
				{ id: "e1", from: "t", to: "age" },
				{ id: "e3", from: "age", to: "gate" },
				{ id: "e4", from: "gate", to: "review", when: "fail" },
			],
		};
		expect(validateWorkflow(rewired).valid).toBe(true);
		expect(issueMessages(rewired)).toContainEqual(
			expect.stringContaining("asks no one"),
		);
	});
});
