import type { OrgRegion } from "@tripwire/contracts";
import type { OrgSettingsTab } from "#/lib/org-search";

export const ORG_SETTINGS_SECTIONS = [
	"members",
	"roles",
	"general",
	"redaction",
	"connections",
	"agents",
	"billing",
] as const;

export type OrgSettingsSection = (typeof ORG_SETTINGS_SECTIONS)[number];

export const ORG_SETTINGS_SECTION_LABELS = {
	members: "Members",
	roles: "Roles",
	general: "General",
	redaction: "Redaction",
	connections: "Connections",
	agents: "Agents",
	billing: "Billing",
} satisfies Record<OrgSettingsSection, string>;

export const ORG_SETTINGS_SECTION_REGIONS: Partial<
	Record<OrgSettingsSection, OrgRegion>
> = {
	members: "members",
	roles: "members",
	general: "settings",
	redaction: "responses",
};

export const ACCOUNT_SECTIONS = [
	"profile",
	"sign-in",
	"preferences",
	"orgs",
] as const;

export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export const ACCOUNT_SECTION_LABELS = {
	profile: "Profile",
	"sign-in": "Sign-in and GitHub",
	preferences: "Preferences",
	orgs: "Orgs",
} satisfies Record<AccountSection, string>;

export function canSeeSettingsSection(
	section: OrgSettingsSection,
	permissions: readonly string[],
): boolean {
	const region = ORG_SETTINGS_SECTION_REGIONS[section];
	return !region || permissions.includes(`${region}:read`);
}

export function visibleSettingsSections(
	permissions: readonly string[],
): OrgSettingsSection[] {
	return ORG_SETTINGS_SECTIONS.filter((section) =>
		canSeeSettingsSection(section, permissions),
	);
}

export function firstSettingsSection(
	permissions: readonly string[],
): OrgSettingsSection {
	return visibleSettingsSections(permissions)[0] ?? "connections";
}

export function sectionForSettingsTab(tab: OrgSettingsTab): OrgSettingsSection {
	return tab === "settings" ? "general" : tab;
}

export function activeAccountSection(hash: string): AccountSection {
	const id = hash.replace(/^#/, "");
	return ACCOUNT_SECTIONS.find((section) => section === id) ?? "profile";
}
