import { z } from "zod";
import { forgeSchema } from "./forges.ts";

export const rerunChangeRequestJobSchema = z
	.object({
		forge: forgeSchema.optional(),
		repoFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
		number: z.number().int().positive(),
		requestedBy: z.string().min(1),
		runId: z.string().min(1).optional(),
	})
	.refine((job) => job.forge !== undefined || job.runId !== undefined);

export type RerunChangeRequestJob = z.infer<typeof rerunChangeRequestJobSchema>;
