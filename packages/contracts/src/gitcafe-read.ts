import { z } from "zod";

export type GitCafeReadBoundary<T> = z.ZodType<T>;

const OID = z.string().regex(/^[0-9a-f]{40}$/);
const COUNT = z.number().int().nonnegative().safe();
const PATH = z.string().min(1).max(4096);
const CURSOR = z
	.string()
	.min(1)
	.max(8192)
	.regex(/^[A-Za-z0-9_-]+$/)
	.nullable();
const SNAPSHOT = {
	id: z.string().min(1),
	version: COUNT,
	headOid: OID,
	baseOid: OID,
	comparisonBaseOid: OID,
};

export const gitCafeReadPullSchema = z.object({
	id: z.string().min(1),
	number: z.number().int().positive().max(2147483647),
	repoId: z.string().min(1),
	version: COUNT,
	headOid: OID.nullable(),
	observedBaseOid: OID.nullable(),
	targetBranch: z.string().min(1),
	changedFiles: COUNT.nullable(),
	additions: COUNT.nullable(),
	deletions: COUNT.nullable(),
});
export type GitCafeReadPull = z.infer<typeof gitCafeReadPullSchema>;

export const gitCafeReadChangeSchema = z.object({
	path: PATH,
	oldPath: PATH.nullable().optional(),
	status: z
		.enum([
			"added",
			"deleted",
			"modified",
			"typeChanged",
			"conflicted",
			"renamed",
			"copied",
		])
		.optional(),
	binary: z.boolean().optional(),
	tooLarge: z.boolean().optional(),
	additions: COUNT.optional(),
	deletions: COUNT.optional(),
});
export type GitCafeReadChange = z.infer<typeof gitCafeReadChangeSchema>;

export const gitCafeReadChangesSchema = z.object({
	...SNAPSHOT,
	items: z.array(gitCafeReadChangeSchema).max(500),
	next: CURSOR,
});
export type GitCafeReadChanges = z.infer<typeof gitCafeReadChangesSchema>;

export const gitCafeReadDiffFileSchema = z.object({
	...SNAPSHOT,
	file: gitCafeReadChangeSchema.extend({
		hunksOmitted: z.boolean().optional(),
		hunks: z
			.array(
				z.object({
					oldStart: COUNT,
					oldLines: COUNT,
					newStart: COUNT,
					newLines: COUNT,
					lines: z
						.array(
							z.object({
								origin: z.enum([" ", "+", "-"]),
								content: z.string().max(262144),
							}),
						)
						.max(262144),
				}),
			)
			.max(65536)
			.optional(),
	}),
});
export type GitCafeReadDiffFile = z.infer<typeof gitCafeReadDiffFileSchema>;

export const gitCafeReadCommitsSchema = z.object({
	...SNAPSHOT,
	truncated: z.boolean(),
	next: CURSOR,
	items: z
		.array(
			z.object({
				oid: OID,
				message: z.string().max(65536),
				author: z.object({
					email: z.string().max(4096),
					timestamp: z
						.number()
						.int()
						.safe()
						.min(-8640000000000)
						.max(8640000000000),
				}),
			}),
		)
		.max(100),
});
export type GitCafeReadCommits = z.infer<typeof gitCafeReadCommitsSchema>;

export const gitCafeReadBlobSchema = z.object({
	commit: OID,
	oid: OID,
	path: PATH,
	size: COUNT.max(1048576),
	binary: z.boolean(),
	content: z.string().max(1048576).nullable(),
});
export type GitCafeReadBlob = z.infer<typeof gitCafeReadBlobSchema>;

export const gitCafeReadProfileSchema = z.object({
	actorId: z.string().min(1),
	handle: z.string().min(1).max(100),
	bio: z.string().nullable(),
});
export type GitCafeReadProfile = z.infer<typeof gitCafeReadProfileSchema>;

export const gitCafeReadPullPageSchema = z.object({
	items: z
		.array(
			z.object({
				id: z.string().min(1),
				number: z.number().int().positive(),
				authorActorId: z.string().min(1),
				state: z.enum(["open", "closed", "merged"]),
				createdAt: z.iso.datetime({ offset: true }),
			}),
		)
		.max(100),
	next: CURSOR,
});
export type GitCafeReadPullPage = z.infer<typeof gitCafeReadPullPageSchema>;

export const gitCafeReadCollaboratorsSchema = z.object({
	items: z
		.array(
			z.object({
				actorId: z.string().min(1),
				role: z.enum([
					"repo-reader",
					"repo-triager",
					"repo-writer",
					"repo-maintainer",
					"repo-admin",
				]),
			}),
		)
		.max(50),
	next: CURSOR,
});
export type GitCafeReadCollaborators = z.infer<
	typeof gitCafeReadCollaboratorsSchema
>;
