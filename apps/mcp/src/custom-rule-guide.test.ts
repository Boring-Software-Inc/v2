import { describe, expect, test } from "bun:test";
import {
	CUSTOM_RULE_GUIDE,
	CUSTOM_RULE_SIGNALS,
	RELEASE_EXAMPLE,
} from "./custom-rule-guide.ts";

describe("the custom rule guide", () => {
	test("shows each release example rule exactly as exported", () => {
		expect(CUSTOM_RULE_GUIDE).toContain(
			JSON.stringify(RELEASE_EXAMPLE.intoRelease),
		);
		expect(CUSTOM_RULE_GUIDE).toContain(
			JSON.stringify(RELEASE_EXAMPLE.fromReleasePlease),
		);
	});

	test("allows release-please by exact branch name, never by substring", () => {
		expect(RELEASE_EXAMPLE.fromReleasePlease.comparison.kind).toBe("oneOf");
		expect(CUSTOM_RULE_GUIDE).not.toContain("starts with release-please");
		expect(CUSTOM_RULE_GUIDE).toContain("never use has as a prefix check");
	});

	test("lists every signal the builder offers", () => {
		expect(CUSTOM_RULE_SIGNALS).toContain("pr.targetBranch (text)");
		expect(CUSTOM_RULE_SIGNALS).toContain("pr.sourceBranch (text)");
		expect(CUSTOM_RULE_GUIDE).toContain(`Signals: ${CUSTOM_RULE_SIGNALS}.`);
	});
});
