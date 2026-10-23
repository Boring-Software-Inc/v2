import { describe, expect, test } from "bun:test";
import {
	type Problem,
	problemCount,
	problemSections,
} from "#/components/workflows/editor/node-issues";

function problem(
	key: string,
	severity: Problem["severity"],
	step = "Trigger",
): Problem {
	return {
		key,
		rule: "no-action",
		severity,
		step,
		message: "Add an action after the trigger.",
		fixes: [],
	};
}

describe("problems panel grouping", () => {
	test("blocking problems come first, then suggestions", () => {
		const sections = problemSections([
			problem("a", "warning", "Trigger 2"),
			problem("b", "error"),
			problem("c", "error", "Workflow"),
		]);
		expect(
			sections.map((section) => ({
				title: section.title,
				keys: section.problems.map((entry) => entry.key),
			})),
		).toEqual([
			{ title: "Fix these to turn it on", keys: ["b", "c"] },
			{ title: "Suggestions", keys: ["a"] },
		]);
	});

	test("empty sections are left out", () => {
		expect(
			problemSections([problem("a", "warning")]).map((s) => s.title),
		).toEqual(["Suggestions"]);
	});

	test("the badge counts what blocks, else the suggestions", () => {
		expect(problemCount([problem("a", "error"), problem("b", "warning")])).toBe(
			"1 to fix",
		);
		expect(
			problemCount([problem("a", "warning"), problem("b", "warning")]),
		).toBe("2 suggestions");
		expect(problemCount([problem("a", "warning")])).toBe("1 suggestion");
	});
});
