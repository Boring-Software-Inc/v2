import { describe, expect, test } from "bun:test";
import { toForgeAction } from "./pr-surface.ts";

describe("toForgeAction — request-review", () => {
	test("carries the recorded people and teams onto the forge action", () => {
		expect(
			toForgeAction(
				{
					kind: "request-review",
					payload: {
						nodeId: "w:review",
						reviewers: ["octocat"],
						teamReviewers: ["core"],
					},
				},
				"a/b",
				7,
				"stamp",
			),
		).toEqual({
			kind: "request-review",
			repoFullName: "a/b",
			number: 7,
			reviewers: ["octocat"],
			teamReviewers: ["core"],
		});
	});

	test("a row recorded before targets existed maps to empty lists", () => {
		expect(
			toForgeAction(
				{ kind: "request-review", payload: { nodeId: "w:review" } },
				"a/b",
				7,
				"stamp",
			),
		).toMatchObject({ reviewers: [], teamReviewers: [] });
	});

	test("a malformed payload maps to empty lists, never a bad request", () => {
		expect(
			toForgeAction(
				{ kind: "request-review", payload: { reviewers: ["bad name"] } },
				"a/b",
				7,
				"stamp",
			),
		).toMatchObject({ reviewers: [], teamReviewers: [] });
	});
});
