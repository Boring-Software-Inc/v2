import { describe, expect, test } from "bun:test";
import { pulledCountText } from "#/workflows-code";

describe("pull says how many workflows it wrote", () => {
	test("the count is what the file holds", () => {
		expect(pulledCountText({ count: 1, pulled: 1 })).toBe("1 workflow");
		expect(pulledCountText({ count: 5, pulled: 5 })).toBe("5 workflows");
	});

	test("a workflow left out is counted apart, never as written", () => {
		expect(pulledCountText({ count: 5, pulled: 6 })).toBe(
			"5 workflows, 1 left out",
		);
	});
});
