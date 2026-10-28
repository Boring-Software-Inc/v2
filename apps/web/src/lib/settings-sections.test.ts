import { describe, expect, test } from "bun:test";
import { ORG_SETTINGS_TABS } from "./org-search";
import {
	ACCOUNT_SECTION_LABELS,
	ACCOUNT_SECTIONS,
	activeAccountSection,
	canSeeSettingsSection,
	firstSettingsSection,
	ORG_SETTINGS_SECTIONS,
	sectionForSettingsTab,
	visibleSettingsSections,
} from "./settings-sections";

const ADMIN = [
	"members:read",
	"members:manage",
	"settings:read",
	"settings:manage",
	"responses:read",
];

describe("settings sections", () => {
	test("every old dialog tab lands on a real section", () => {
		for (const tab of ORG_SETTINGS_TABS) {
			expect(ORG_SETTINGS_SECTIONS).toContain(sectionForSettingsTab(tab));
		}
		expect(sectionForSettingsTab("settings")).toBe("general");
		expect(sectionForSettingsTab("members")).toBe("members");
	});

	test("an admin sees every section, members first", () => {
		expect(visibleSettingsSections(ADMIN)).toEqual([...ORG_SETTINGS_SECTIONS]);
		expect(firstSettingsSection(ADMIN)).toBe("members");
	});

	test("a role without member access starts on the first section it can read", () => {
		const permissions = ["settings:read"];
		expect(canSeeSettingsSection("members", permissions)).toBe(false);
		expect(canSeeSettingsSection("roles", permissions)).toBe(false);
		expect(canSeeSettingsSection("redaction", permissions)).toBe(false);
		expect(firstSettingsSection(permissions)).toBe("general");
		expect(firstSettingsSection([])).toBe("connections");
	});

	test("the account hash picks the account section, profile by default", () => {
		expect(activeAccountSection("")).toBe("profile");
		expect(activeAccountSection("#sign-in")).toBe("sign-in");
		expect(activeAccountSection("orgs")).toBe("orgs");
		expect(activeAccountSection("#preferences")).toBe("preferences");
		expect(ACCOUNT_SECTION_LABELS.preferences).toBe("Preferences");
		expect(ACCOUNT_SECTIONS).not.toContain("theme");
		expect(activeAccountSection("#nope")).toBe("profile");
	});
});
