export type OrgSettingsTab = "members" | "settings" | "billing";

export function parseOrgSettingsTab(
	value: unknown,
): OrgSettingsTab | undefined {
	return value === "members" || value === "settings" || value === "billing"
		? value
		: undefined;
}
