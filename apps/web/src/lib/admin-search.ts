import { ACCESS_STATUSES } from "@tripwire/contracts";
import { z } from "zod";

export const ADMIN_USER_STATUSES = ["all", ...ACCESS_STATUSES] as const;

export const ADMIN_USERS_SEARCH_DEFAULTS = { status: "all" } as const;

export const adminUsersSearchSchema = z.object({
	status: z
		.enum(ADMIN_USER_STATUSES)
		.default(ADMIN_USERS_SEARCH_DEFAULTS.status)
		.catch(ADMIN_USERS_SEARCH_DEFAULTS.status),
	online: z.boolean().optional().catch(undefined),
});

export type AdminUsersSearch = z.infer<typeof adminUsersSearchSchema>;

export const ADMIN_REPO_STATUSES = ["all", "protected", "unprotected"] as const;

export const ADMIN_REPOS_SEARCH_DEFAULTS = { status: "all" } as const;

export const adminReposSearchSchema = z.object({
	status: z
		.enum(ADMIN_REPO_STATUSES)
		.default(ADMIN_REPOS_SEARCH_DEFAULTS.status)
		.catch(ADMIN_REPOS_SEARCH_DEFAULTS.status),
});

export type AdminReposSearch = z.infer<typeof adminReposSearchSchema>;

export const ADMIN_ORG_KINDS = ["all", "team", "personal"] as const;

export const ADMIN_ORGS_SEARCH_DEFAULTS = { kind: "all" } as const;

export const adminOrgsSearchSchema = z.object({
	kind: z
		.enum(ADMIN_ORG_KINDS)
		.default(ADMIN_ORGS_SEARCH_DEFAULTS.kind)
		.catch(ADMIN_ORGS_SEARCH_DEFAULTS.kind),
});

export type AdminOrgsSearch = z.infer<typeof adminOrgsSearchSchema>;
