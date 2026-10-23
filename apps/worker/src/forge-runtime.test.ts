import { describe, expect, test } from "bun:test";
import { githubAppIdSchema } from "./forge-runtime.ts";

describe("GITHUB_APP_ID is the app's own identity", () => {
	test("the production and staging ids parse to numbers", () => {
		expect(githubAppIdSchema.parse("4291944")).toBe(4291944);
		expect(githubAppIdSchema.parse("3169732")).toBe(3169732);
	});

	test("a slug, a blank or a negative id is refused", () => {
		for (const value of ["tripwire-sh", "", "-4", "1.5"]) {
			expect(githubAppIdSchema.safeParse(value).success).toBe(false);
		}
	});
});
