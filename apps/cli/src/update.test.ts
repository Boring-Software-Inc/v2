import { expect, test } from "bun:test";
import { isNewerCliRelease } from "#/update";

test.each([
	["0.1.9", "0.1.10", true],
	["0.9.9", "0.10.0", true],
	["0.1.27", "0.1.27", false],
	["0.1.27", "0.1.26", false],
	["0.1.25-staging.9", "0.1.25-staging.10", true],
	["0.1.25-staging.43", "0.1.26-staging.1", true],
	["0.1.25-staging.43", "0.1.26", false],
	["0.1.25", "0.1.26-staging.1", false],
	["0.1.25", "0.1.26; echo bad", false],
])("release %s → %s returns %s", (installed, candidate, expected) => {
	expect(isNewerCliRelease(installed, candidate)).toBe(expected);
});
