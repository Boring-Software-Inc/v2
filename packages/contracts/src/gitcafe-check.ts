import { z } from "zod";

export const gitCafeCheckConclusionSchema = z.enum([
	"success",
	"failure",
	"neutral",
	"cancelled",
	"skipped",
	"timed_out",
	"action_required",
	"stale",
	"startup_failure",
]);
export type GitCafeCheckConclusion = z.infer<
	typeof gitCafeCheckConclusionSchema
>;

export const gitCafeReportedCheckSchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	headOid: z.string().regex(/^[0-9a-f]{40}$/),
	name: z.string().min(1),
	status: z.enum(["queued", "in_progress", "completed"]),
	conclusion: gitCafeCheckConclusionSchema.nullable(),
	installationId: z.string().min(1).nullable(),
	reporterId: z.string().min(1),
	reportedAt: z.iso.datetime(),
	rerequestedAt: z.iso.datetime().nullable(),
	rerequestable: z.boolean(),
	detailsUrl: z.string().nullable(),
	externalId: z.string().nullable(),
	output: z.object({
		title: z.string().nullable(),
		summary: z.string().nullable(),
		text: z.string().nullable(),
	}),
});
export type GitCafeReportedCheck = z.infer<typeof gitCafeReportedCheckSchema>;

export const gitCafeCheckReportResponseSchema = z.object({
	outcome: z.enum(["created", "updated", "unchanged", "ignored_stale"]),
	checkRun: gitCafeReportedCheckSchema,
});
export type GitCafeCheckReportResponse = z.infer<
	typeof gitCafeCheckReportResponseSchema
>;

export const gitCafeCheckWriteSchema = z
	.strictObject({
		name: z.literal("tripwire"),
		status: z.enum(["queued", "in_progress", "completed"]),
		conclusion: gitCafeCheckConclusionSchema
			.exclude(["stale", "startup_failure"])
			.optional(),
		reportedAt: z.iso.datetime(),
		detailsUrl: z.url().max(2048).optional(),
		externalId: z.string().min(1).max(255).optional(),
		output: z.strictObject({
			title: z.string().max(255),
			summary: z.string().max(65535),
		}),
		rerequestable: z.boolean(),
	})
	.refine((check) =>
		check.status === "completed"
			? check.conclusion !== undefined
			: check.conclusion === undefined,
	);
export type GitCafeCheckWrite = z.infer<typeof gitCafeCheckWriteSchema>;

export const gitCafeCheckReportInputSchema = z.strictObject({
	repoFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
	headOid: gitCafeReportedCheckSchema.shape.headOid,
	key: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
	check: gitCafeCheckWriteSchema,
});
export type GitCafeCheckReportInput = z.infer<
	typeof gitCafeCheckReportInputSchema
>;
