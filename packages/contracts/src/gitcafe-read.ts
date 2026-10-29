import { z } from "zod";
import { gitCafePullIdentitySchema } from "./gitcafe-events.ts";
import { gitCafeInstallationFailureReasonSchema } from "./gitcafe-installation.ts";
import { repoLabelSchema } from "./workflow.ts";

export type GitCafeReadBoundary<T> = z.ZodType<T>;

export const gitCafeReadDiagnosticSchema = z.strictObject({
	source: z.enum([
		"merged-history",
		"organization-membership",
		"repository-collaborators",
	]),
	reason: gitCafeInstallationFailureReasonSchema.or(
		z.enum(["changed", "incomplete", "pagination"]),
	),
	status: z.number().int().min(100).max(599).optional(),
});
export type GitCafeReadDiagnostic = z.infer<typeof gitCafeReadDiagnosticSchema>;

export const gitCafeRepositoryBindingSchema = z.strictObject({
	repoId: z.uuid(),
	organizationId: z.string().min(1),
	installationId: z.string().min(1),
	repositoryId: z.string().min(1),
	fullName: z.string().min(1),
	generation: z.number().int().nonnegative().safe(),
});
export type GitCafeRepositoryBinding = z.infer<
	typeof gitCafeRepositoryBindingSchema
>;

export const gitCafeCatalogValuesSchema = z.strictObject({
	branches: z.array(z.string().min(1)).optional(),
	labels: z.array(repoLabelSchema).optional(),
});
export type GitCafeCatalogValues = z.infer<typeof gitCafeCatalogValuesSchema>;

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

export const gitCafeReadRefPageSchema = z.object({
	items: z
		.array(z.object({ name: z.string().min(1).max(255), oid: OID }))
		.max(200),
	next: CURSOR,
});
export type GitCafeReadRefPage = z.infer<typeof gitCafeReadRefPageSchema>;

export const gitCafeReadLabelPageSchema = z.object({
	items: z
		.array(
			z.object({
				id: z.string().min(1),
				repoId: z.string().min(1),
				name: z.string().min(1),
				color: z.string(),
				description: z.string().nullable(),
			}),
		)
		.max(100),
	next: CURSOR,
});
export type GitCafeReadLabelPage = z.infer<typeof gitCafeReadLabelPageSchema>;

export const gitCafeReadPullThreadItemSchema = z.object({
	id: z.string().min(1),
	number: z.number().int().positive().max(2147483647),
	title: z.string(),
	version: COUNT,
	state: z.enum(["open", "closed", "merged"]),
	updatedAt: z.iso.datetime(),
	authorActorId: z.string().min(1).nullable(),
	author: gitCafePullIdentitySchema.shape.author,
});
export type GitCafeReadPullThreadItem = z.infer<
	typeof gitCafeReadPullThreadItemSchema
>;

export const gitCafeReadPullThreadPageSchema = z.object({
	items: z.array(gitCafeReadPullThreadItemSchema).max(100),
	next: CURSOR,
});
export type GitCafeReadPullThreadPage = z.infer<
	typeof gitCafeReadPullThreadPageSchema
>;

export const gitCafeReadPullThreadSchema =
	gitCafeReadPullThreadItemSchema.extend({
		repoId: z.string().min(1),
		lockedAt: z.iso.datetime().nullable(),
	});
export type GitCafeReadPullThread = z.infer<typeof gitCafeReadPullThreadSchema>;

export const gitCafeReadIssueThreadSchema = gitCafeReadPullThreadSchema
	.omit({ state: true })
	.extend({
		stateType: z.enum([
			"triage",
			"backlog",
			"unstarted",
			"started",
			"completed",
			"canceled",
		]),
	});
export type GitCafeReadIssueThread = z.infer<
	typeof gitCafeReadIssueThreadSchema
>;

export const gitCafeReadIssueThreadPageSchema = z.object({
	items: z.array(gitCafeReadIssueThreadSchema).max(100),
	next: CURSOR,
});
export type GitCafeReadIssueThreadPage = z.infer<
	typeof gitCafeReadIssueThreadPageSchema
>;

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
