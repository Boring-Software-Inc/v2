import { describe, expect, test } from "bun:test";
import { deletionSteps, installationSettingsUrl } from "#/lib/account-deletion";

describe("installationSettingsUrl", () => {
	test("an org install opens the org's installed apps", () => {
		expect(
			installationSettingsUrl({
				forge: "github",
				accountLogin: "acme",
				accountType: "Organization",
			}),
		).toBe("https://github.com/organizations/acme/settings/installations");
	});

	test("a personal install opens your installed apps", () => {
		expect(
			installationSettingsUrl({
				forge: "github",
				accountLogin: "grim",
				accountType: "User",
			}),
		).toBe("https://github.com/settings/installations");
	});

	test("an install with no login still opens your installed apps", () => {
		expect(
			installationSettingsUrl({
				forge: "github",
				accountLogin: null,
				accountType: null,
			}),
		).toBe("https://github.com/settings/installations");
	});

	test("another forge has no link", () => {
		expect(
			installationSettingsUrl({
				forge: "opengit",
				accountLogin: "acme",
				accountType: "Organization",
			}),
		).toBeNull();
	});
});

describe("deletionSteps", () => {
	test("a sole admin stops at the block", () => {
		expect(deletionSteps({ soleAdminOrgs: 1, onRepos: 3 })).toEqual([
			"blocked",
		]);
	});

	test("repos that are on come first", () => {
		expect(deletionSteps({ soleAdminOrgs: 0, onRepos: 2 })).toEqual([
			"repos",
			"checks",
			"confirm",
		]);
	});

	test("with nothing on, the flow starts at the checks", () => {
		expect(deletionSteps({ soleAdminOrgs: 0, onRepos: 0 })).toEqual([
			"checks",
			"confirm",
		]);
	});
});
