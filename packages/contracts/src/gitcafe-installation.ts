import { z } from "zod";

export const gitCafePermissionSchema = z.object({
	kind: z.enum(["repo", "branch", "pr", "issue", "comment", "org", "team"]),
	family: z.string().min(1),
	level: z.enum(["read", "write", "admin"]),
});
export type GitCafePermission = z.infer<typeof gitCafePermissionSchema>;

export const gitCafeInstallationSchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	org: z.string().min(1),
	bot: z.object({
		actorId: z.string().min(1),
		handle: z.string().min(1),
	}),
	version: z.number().int().positive(),
	revision: z.number().int().positive(),
	repositorySelection: z.enum(["all", "selected"]),
	repositories: z.array(z.string().min(1)),
	permissions: z.array(gitCafePermissionSchema),
	pausedAt: z.iso.datetime().nullable(),
	suspendedAt: z.iso.datetime().nullable(),
	uninstalledAt: z.iso.datetime().nullable(),
});
export type GitCafeInstallation = z.infer<typeof gitCafeInstallationSchema>;

export const gitCafeInstallationTokenSchema = z.object({
	token: z.string().min(1),
	expiresAt: z.iso.datetime(),
	installationId: z.string().min(1),
	actor: z.string().min(1),
	repositorySelection: z.enum(["all", "selected"]),
	repositories: z.array(z.string().min(1)),
	permissions: z.array(gitCafePermissionSchema),
});
export type GitCafeInstallationToken = z.infer<
	typeof gitCafeInstallationTokenSchema
>;

export const gitCafeOrganizationMembersSchema = z.object({
	items: z.array(
		z.object({
			actorId: z.string().min(1),
			role: z.string().min(1),
		}),
	),
	next: z
		.string()
		.min(1)
		.max(8192)
		.regex(/^[A-Za-z0-9_-]+$/)
		.nullable(),
});
export type GitCafeOrganizationMembers = z.infer<
	typeof gitCafeOrganizationMembersSchema
>;

export const gitCafeConnectionRepositorySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	owner: z.string().min(1),
	visibility: z.enum(["public", "private"]),
	archivedAt: z.string().nullable(),
});
export type GitCafeConnectionRepository = z.infer<
	typeof gitCafeConnectionRepositorySchema
>;

export const gitCafeConnectionRepositoriesSchema = z.array(
	gitCafeConnectionRepositorySchema,
);
export type GitCafeConnectionRepositories = z.infer<
	typeof gitCafeConnectionRepositoriesSchema
>;

export const gitCafeConnectionRepositoryPageSchema = z.object({
	items: z.array(gitCafeConnectionRepositorySchema).max(50),
	next: gitCafeOrganizationMembersSchema.shape.next,
});
export type GitCafeConnectionRepositoryPage = z.infer<
	typeof gitCafeConnectionRepositoryPageSchema
>;
