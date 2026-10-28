import { z } from "zod";

export const gitCafePublicRepositorySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	owner: z.string().min(1),
	visibility: z.literal("public"),
	defaultBranch: z.string().min(1),
	version: z.number().int().nonnegative(),
});
export type GitCafePublicRepository = z.infer<
	typeof gitCafePublicRepositorySchema
>;

export const gitCafePublicProfileSchema = z.object({
	actorId: z.string().min(1),
	handle: z.string().min(1),
});
export type GitCafePublicProfile = z.infer<typeof gitCafePublicProfileSchema>;

export const gitCafePublicPullSchema = z.object({
	id: z.string().min(1),
	number: z.number().int().positive(),
	headOid: z.string().min(1),
	version: z.number().int().nonnegative(),
});
export type GitCafePublicPull = z.infer<typeof gitCafePublicPullSchema>;

export const gitCafePublicBlobSchema = z.object({
	commit: z.string().min(1),
	oid: z.string().min(1),
	path: z.string().min(1),
	size: z.number().int().nonnegative(),
	binary: z.boolean(),
	content: z.string().nullable(),
});
export type GitCafePublicBlob = z.infer<typeof gitCafePublicBlobSchema>;
