import { describe, expect, test } from "bun:test";
import { pickValue } from "./pick-value";

describe("pickValue", () => {
	test("returns a listed value and rejects the rest", () => {
		expect(pickValue(["a", "b"], "b")).toBe("b");
		expect(pickValue(["a", "b"], "c")).toBeUndefined();
	});
});
