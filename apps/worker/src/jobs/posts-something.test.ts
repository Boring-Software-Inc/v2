import { describe, expect, test } from "bun:test";
import { postsSomething } from "./run-workflows.ts";

describe("postsSomething", () => {
	test("a removed Discord step records nothing", () => {
		expect(postsSomething({ action: "discord" })).toBe(false);
	});

	test("a removed Comment step records nothing", () => {
		expect(postsSomething({ action: "comment" })).toBe(false);
	});

	test("live steps still record", () => {
		for (const action of ["block", "label", "webhook", "send-to-moderation"]) {
			expect(postsSomething({ action })).toBe(true);
		}
	});
});
