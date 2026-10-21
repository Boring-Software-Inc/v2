import { z } from "zod";

export const adminUsersSearchSchema = z.object({
	online: z.boolean().optional().catch(undefined),
});

export type AdminUsersSearch = z.infer<typeof adminUsersSearchSchema>;

export const ADMIN_REPO_STATUSES = ["protected", "unprotected"] as const;

export const adminReposSearchSchema = z.object({
	status: z.enum(ADMIN_REPO_STATUSES).optional().catch(undefined),
});

export type AdminReposSearch = z.infer<typeof adminReposSearchSchema>;
