export type OrgSettingsTab =
	| "members"
	| "settings"
	| "redaction"
	| "connections"
	| "billing";

const TAB_VALUES: OrgSettingsTab[] = [
	"members",
	"settings",
	"redaction",
	"connections",
	"billing",
];

export function parseOrgSettingsTab(
	value: unknown,
): OrgSettingsTab | undefined {
	return TAB_VALUES.find((tab) => tab === value);
}
