import { describe, expect, test } from "bun:test";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";

function summary(params: Parameters<typeof reviewNode>[0]) {
	return nodeFieldValues(reviewNode(params)).map(
		({ field, value }) =>
			`${field.label}: ${summarizeFieldValue(field, value)}`,
	);
}

function reviewNode(params?: {
	reviewers?: (string | { id: number; login: string })[];
	teamReviewers?: string[];
}) {
	return {
		id: "a",
		type: "action" as const,
		action: "request-review" as const,
		params,
	};
}

describe("nodeFieldValues — request-review", () => {
	test("shows the people and teams it asks", () => {
		expect(
			summary({
				reviewers: [{ id: 1, login: "octocat" }, "hubot"],
				teamReviewers: ["core"],
			}),
		).toEqual(["Reviewers: octocat +1", "Teams: core"]);
	});

	test("an action with no targets says so", () => {
		expect(summary(undefined)).toEqual(["Reviewers: not set"]);
	});
});
