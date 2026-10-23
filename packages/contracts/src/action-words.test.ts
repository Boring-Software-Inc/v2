import { describe, expect, test } from "bun:test";
import { actionDone, actionEffect, listWords } from "./action-words.ts";

describe("action words", () => {
	test("an action says what it does, naming its labels", () => {
		expect(actionEffect("label", { labels: ["stale"] })).toBe(
			"adds the label stale",
		);
		expect(actionEffect("label", { labels: ["a", "b"] })).toBe(
			"adds the labels a and b",
		);
		expect(actionEffect("remove-label", { labels: ["wip"] })).toBe(
			"removes the label wip",
		);
		expect(actionEffect("post-comment", { message: "hi" })).toBe(
			"posts your comment",
		);
		expect(
			actionEffect("request-review", {
				reviewers: ["octocat"],
				teamReviewers: [],
			}),
		).toBe("requests GitHub review from octocat");
		expect(actionEffect("close", {})).toBe("closes it");
	});

	test("a done action reads as a chip that says what it added", () => {
		expect(actionDone("label", { labels: ["needs-a-human"] })).toBe(
			"Labeled needs-a-human",
		);
		expect(actionDone("label", { labels: ["human-approved"] })).not.toBe(
			actionDone("label", { labels: ["needs-a-human"] }),
		);
		expect(actionDone("comment", {})).toBe("Verdict comment");
		expect(actionDone("post-comment", { message: "x" })).toBe(
			"Workflow comment",
		);
		expect(actionDone("set-check", {})).toBeNull();
	});

	test("lists join the way a person writes them", () => {
		expect(listWords(["a"])).toBe("a");
		expect(listWords(["a", "b", "c"])).toBe("a, b and c");
	});
});
