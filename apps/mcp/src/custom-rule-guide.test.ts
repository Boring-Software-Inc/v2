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

	test("allows release-please by branch prefix, never by substring", () => {
		expect(RELEASE_EXAMPLE.fromReleasePlease.comparison).toEqual({
			kind: "startsWith",
			args: ["release-please"],
		});
		expect(CUSTOM_RULE_GUIDE).toContain("starts with release-please");
		expect(CUSTOM_RULE_GUIDE).toContain("never use has as a prefix check");
	});

	test("lists every signal the builder offers", () => {
		expect(CUSTOM_RULE_SIGNALS).toContain("pr.targetBranch (text)");
		expect(CUSTOM_RULE_SIGNALS).toContain("pr.sourceBranch (text)");
		expect(CUSTOM_RULE_GUIDE).toContain(`Signals: ${CUSTOM_RULE_SIGNALS}.`);
	});

	test("names the outcomes and the Block default", () => {
		expect(CUSTOM_RULE_GUIDE).toContain("block (the default)");
		expect(CUSTOM_RULE_GUIDE).toContain("request_fix with an instruction");
	});
});
