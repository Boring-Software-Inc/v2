import { z } from "zod";

export const ORG_SETTINGS_TABS = [
	"members",
	"roles",
	"settings",
	"redaction",
	"connections",
	"agents",
	"billing",
] as const;

export type OrgSettingsTab = (typeof ORG_SETTINGS_TABS)[number];

export const INVITE_STATUSES = ["active", "expired", "revoked"] as const;

export const ORG_SEARCH_DEFAULTS = { invites: "active" } as const;

export const orgSearchSchema = z.object({
	settings: z.enum(ORG_SETTINGS_TABS).optional().catch(undefined),
	invites: z
		.enum(INVITE_STATUSES)
		.default(ORG_SEARCH_DEFAULTS.invites)
		.catch(ORG_SEARCH_DEFAULTS.invites),
});
