import { describe, expect, test } from "bun:test";
import {
	type JsonValue,
	MAX_REVIEW_TARGETS,
	requestReviewParamsSchema,
	requestReviewTargetsSchema,
	reviewerJson,
	sameReviewer,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "./workflow.ts";
import { applyLintEdit, lintWorkflow } from "./workflow-lint.ts";
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

test("GitCafe reviewer references preserve immutable string IDs and provider handles", () => {
	const reviewer = {
		id: "act_stable-reviewer",
		login: "person_with_a_provider_handle",
	};
	const parsed = requestReviewParamsSchema.parse({ reviewers: [reviewer] });
	expect(reviewerJson(parsed.reviewers)).toEqual([reviewer]);
	expect(sameReviewer(reviewer, { ...reviewer, login: "renamed" })).toBe(true);
	expect(sameReviewer(reviewer, { ...reviewer, id: "act_other" })).toBe(false);
	expect(
		requestReviewParamsSchema.safeParse({
			reviewers: [{ id: 123, login: reviewer.login }],
		}).success,
	).toBe(false);
});

test("empty PR-specific suggestions do not revoke a saved GitCafe reviewer", () => {
	const def = withReviewParams({
		reviewers: [{ id: "act_stable", login: "saved_person" }],
	});
	expect(
		lintWorkflow(def, { reviewers: [] }).filter(
			(finding) => finding.rule === "stale-reviewer",
		),
	).toEqual([]);
});

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
				reviewers: [{ id: 1, login: "a-b" }, "C3"],
				teamReviewers: ["infra_ops"],
			}),
		).toEqual({
			reviewers: [{ id: 1, login: "a-b" }, { login: "C3" }],
			teamReviewers: ["infra_ops"],
		});
	});

	test("defaults missing lists to empty and drops unknown keys", () => {
		expect(
			requestReviewTargetsSchema.parse({ nodeId: "w:a", reviewers: ["x"] }),
		).toEqual({ reviewers: [{ login: "x" }], teamReviewers: [] });
	});

	test("reads stored logins as reviewers without an id", () => {
		expect(
			requestReviewTargetsSchema.parse({ reviewers: ["octocat"] }).reviewers,
		).toEqual([{ login: "octocat" }]);
		expect(
			reviewerJson(
				requestReviewTargetsSchema.parse({
					reviewers: ["octocat", { id: 2, login: "hubot" }],
				}).reviewers,
			),
		).toEqual([{ login: "octocat" }, { id: 2, login: "hubot" }]);
	});

	test("rejects a reviewer with a bad id or login", () => {
		expect(
			requestReviewParamsSchema.safeParse({
				reviewers: [{ id: -1, login: "octocat" }],
			}).success,
		).toBe(false);
		expect(
			requestReviewParamsSchema.safeParse({
				reviewers: [{ id: 1, login: "bad name" }],
			}).error?.issues[0]?.message,
		).toBe("bad name is not a GitHub username");
	});

	test("matches reviewers by id when both have one, else by login", () => {
		expect(
			sameReviewer({ id: 1, login: "old" }, { id: 1, login: "renamed" }),
		).toBe(true);
		expect(sameReviewer({ id: 1, login: "a" }, { id: 2, login: "a" })).toBe(
			false,
		);
		expect(
			sameReviewer({ login: "OctoCat" }, { id: 3, login: "octocat" }),
		).toBe(true);
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
			rule: "review-targets",
			severity: "error",
			step: "Request GitHub review",
			nodeId: "a",
			message: "Pick people or teams to ask.",
			fixes: [
				{
					label: "Add reviewers",
					intent: { type: "focus-field", nodeId: "a", field: "reviewers" },
				},
			],
		});
	});

	test("enable-time validation reports a malformed target", () => {
		expect(
			messagesOf(
				validateWorkflowForEnable(
					withReviewParams({ reviewers: ["bad name"] }),
				),
			),
		).toContain("Fix the reviewers: bad name is not a GitHub username.");
	});

	test("a node with targets enables", () => {
		expect(
			validateWorkflowForEnable(
				withReviewParams({ reviewers: ["octocat"], teamReviewers: ["core"] }),
			).valid,
		).toBe(true);
	});
});

describe("stale-reviewer", () => {
	const synced = [{ id: 1, login: "octocat" }];

	test("is silent until the repo has a synced set", () => {
		const def = withReviewParams({ reviewers: [{ id: 9, login: "gone" }] });
		expect(
			lintWorkflow(def).filter((result) => result.rule === "stale-reviewer"),
		).toEqual([]);
	});

	test("warns on a chosen reviewer missing from the synced set, with a Remove fix", () => {
		const gone = { id: 9, login: "gone" };
		const def = withReviewParams({
			reviewers: [{ id: 1, login: "octocat" }, gone, "legacy"],
		});
		const stale = lintWorkflow(def, { reviewers: synced }).filter(
			(result) => result.rule === "stale-reviewer",
		);
		expect(stale.map((result) => [result.step, result.message])).toEqual([
			[
				"Request GitHub review",
				"Remove gone. They can no longer review this repo.",
			],
			[
				"Request GitHub review",
				"Remove legacy. They can no longer review this repo.",
			],
		]);
		expect(stale[0]).toMatchObject({
			severity: "warning",
			nodeId: "a",
			fixes: [
				{
					label: "Remove",
					edit: { type: "remove-reviewer", nodeId: "a", reviewer: gone },
				},
			],
		});
	});

	test("a stale reviewer never blocks enable", () => {
		expect(
			validateWorkflowForEnable(
				withReviewParams({ reviewers: [{ id: 9, login: "gone" }] }),
			).valid,
		).toBe(true);
	});

	test("Remove drops only that reviewer", () => {
		const def = withReviewParams({
			reviewers: [{ id: 1, login: "octocat" }, "legacy"],
		});
		const next = applyLintEdit(def, {
			type: "remove-reviewer",
			nodeId: "a",
			reviewer: { login: "Legacy" },
		});
		expect(next.nodes.find((node) => node.id === "a")).toMatchObject({
			params: { reviewers: [{ id: 1, login: "octocat" }] },
		});
	});
});
