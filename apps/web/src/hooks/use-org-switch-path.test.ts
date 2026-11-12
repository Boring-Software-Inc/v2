import { describe, expect, test } from "bun:test";
import { orgSwitchPath } from "#/hooks/use-org-switch-path";

describe("orgSwitchPath", () => {
	test("keeps the current page, query, and hash", () => {
		expect(
			orgSwitchPath({
				currentOrg: "dev-owner",
				nextOrg: "demo-team",
				pathname: "/dev-owner/settings/account",
				search: "?tab=security",
				hash: "preferences",
			}),
		).toBe("/demo-team/settings/account?tab=security#preferences");
	});

	test("falls back to the next workspace home outside org routes", () => {
		expect(
			orgSwitchPath({
				currentOrg: undefined,
				nextOrg: "demo-team",
				pathname: "/account",
			}),
		).toBe("/demo-team/home");
	});
});
