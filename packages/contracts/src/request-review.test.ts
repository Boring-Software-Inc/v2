import { describe, expect, test } from "bun:test";
import {
	type JsonValue,
	MAX_REVIEW_TARGETS,
	requestReviewParamsSchema,
	requestReviewTargetsSchema,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "./workflow.ts";
import {
	validateWorkflow,
	validateWorkflowForEnable,
} from "./workflow-validate.ts";

function withReviewParams(
	params: Record<string, JsonValue> | undefined,
): WorkflowDefinition {
	return {
		id: "w",
		name: "w",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
			{ id: "a", type: "action", action: "request-review", params },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	};
}

function messagesOf(result: ReturnType<typeof validateWorkflow>): string[] {
	return result.valid ? [] : result.issues.map((issue) => issue.message);
}

describe("requestReviewParamsSchema", () => {
	test("accepts people, teams, or both", () => {
		expect(
			requestReviewParamsSchema.safeParse({ reviewers: ["octocat"] }).success,
		).toBe(true);
		expect(
			requestReviewParamsSchema.safeParse({ teamReviewers: ["core-team"] })
				.success,
		).toBe(true);
		expect(
			requestReviewParamsSchema.parse({
				reviewers: ["a-b", "C3"],
				teamReviewers: ["infra_ops"],
			}),
		).toEqual({ reviewers: ["a-b", "C3"], teamReviewers: ["infra_ops"] });
	});

	test("defaults missing lists to empty and drops unknown keys", () => {
		expect(
			requestReviewTargetsSchema.parse({ nodeId: "w:a", reviewers: ["x"] }),
		).toEqual({ reviewers: ["x"], teamReviewers: [] });
	});

	test("requires at least one target", () => {
		const result = requestReviewParamsSchema.safeParse({});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			"add at least one person or team to ask",
		);
	});

	test("rejects malformed usernames and team slugs by name", () => {
		for (const bad of [
			"-lead",
			"trail-",
			"dou--ble",
			"has space",
			"a".repeat(40),
		]) {
			expect(
				requestReviewParamsSchema.safeParse({ reviewers: [bad] }).success,
			).toBe(false);
		}
		expect(
			requestReviewParamsSchema.safeParse({ reviewers: ["@octocat"] }).error
				?.issues[0]?.message,
		).toBe("@octocat is not a GitHub username");
		expect(
			requestReviewParamsSchema.safeParse({ teamReviewers: ["org/team"] }).error
				?.issues[0]?.message,
		).toBe("org/team is not a team slug");
	});

	test("caps the combined target count", () => {
		const people = Array.from({ length: 10 }, (_, i) => `user${i}`);
		const teams = Array.from({ length: 6 }, (_, i) => `team${i}`);
		const result = requestReviewParamsSchema.safeParse({
			reviewers: people,
			teamReviewers: teams,
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			`ask at most ${MAX_REVIEW_TARGETS} people and teams`,
		);
		expect(
			requestReviewParamsSchema.safeParse({
				reviewers: Array.from({ length: 16 }, (_, i) => `user${i}`),
			}).success,
		).toBe(false);
	});
});

describe("request-review in workflow validation", () => {
	test("a stored node with no targets still parses and passes the base check", () => {
		const def = withReviewParams(undefined);
		expect(workflowDefinitionSchema.safeParse(def).success).toBe(true);
		expect(validateWorkflow(def).valid).toBe(true);
	});

	test("enable-time validation names the missing target on the node", () => {
		const result = validateWorkflowForEnable(withReviewParams(undefined));
		expect(result.valid).toBe(false);
		expect(result.valid ? [] : result.issues).toContainEqual({
			nodeId: "a",
			message: "Request review: add at least one person or team to ask",
		});
	});

	test("enable-time validation reports a malformed target", () => {
		expect(
			messagesOf(
				validateWorkflowForEnable(
					withReviewParams({ reviewers: ["bad name"] }),
				),
			),
		).toContain("Request review: bad name is not a GitHub username");
	});

	test("a node with targets enables", () => {
		expect(
			validateWorkflowForEnable(
				withReviewParams({ reviewers: ["octocat"], teamReviewers: ["core"] }),
			).valid,
		).toBe(true);
	});
});
