import { z } from "zod";
import { forgeSchema } from "./forges.ts";

/** A linked sign-in account with active repos visible across the caller's orgs and claimable installations. */
export const forgeConnectionSchema = z.object({
	forge: forgeSchema,
	/** A forge account ID, distinct from a GitHub App installation ID. */
	accountId: z.string(),
	repoCount: z.number(),
	unclaimedCount: z.number(),
	accessTokenExpiresAt: z
		.union([z.string(), z.date()])
		.nullable()
		.transform((value) => (value ? new Date(value).toISOString() : null)),
	canRefresh: z.boolean(),
});

export type ForgeConnection = z.infer<typeof forgeConnectionSchema>;
