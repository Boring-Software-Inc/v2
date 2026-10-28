import { z } from "zod";
import { forgeIdSchema } from "./forges.ts";

/**
 * Repo domain (spec §4 `repo.ts`). Extracted from the demo's
 * `integrations.types.ts` — `Repo` was the demo's `ConnectedRepo`, `RepoRef`
 * its `Repository`. `RepoConfig` lands with the rules-UI build step.
 */

/** Repository names are unique only within a forge. This scope carries no authorization. */
export const repoIdentitySchema = z.object({
	forge: forgeIdSchema,
	fullName: z.string().min(1),
});
export type RepoIdentity = z.infer<typeof repoIdentitySchema>;

export const repoArmingResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), armed: z.boolean() }),
	z.strictObject({
		ok: z.literal(false),
		armed: z.literal(false),
		reason: z.literal("protection-unavailable"),
	}),
]);
export type RepoArmingResult = z.infer<typeof repoArmingResultSchema>;

/** A lightweight owner/name reference to a repo (was demo `Repository`). */
export const repoRefSchema = z.object({
	owner: z.string(),
	name: z.string(),
	fullName: z.string(),
});
export type RepoRef = z.infer<typeof repoRefSchema>;

export const githubAccountSchema = z.object({
	id: z.string(),
	/** The org/user handle, e.g. "vercel". */
	login: z.string(),
	name: z.string(),
	/**
	 * Forge-derived values — GitHub controls this set. Stays closed for mocks;
	 * needs a passthrough/catch variant when real ingest lands (step 3/4).
	 */
	type: z.enum(["Organization", "User"]),
	avatarUrl: z.string(),
	/**
	 * Whether the app can see every repo or a hand-picked subset. Forge-derived
	 * (GitHub's `repository_selection`) — stays closed for mocks; needs a
	 * passthrough/catch variant when real ingest lands (step 3/4).
	 */
	repoAccess: z.enum(["all", "selected"]),
	repoCount: z.number(),
	installedAt: z.iso.datetime(),
});
export type GithubAccount = z.infer<typeof githubAccountSchema>;

/** A repo tripwire is installed on (was demo `ConnectedRepo`). */
export const repoSchema = z.object({
	id: z.string(),
	owner: z.string(),
	name: z.string(),
	fullName: z.string(),
	private: z.boolean(),
	/** Last push to the repo. */
	pushedAt: z.iso.datetime(),
	/** Items currently flagged in the moderation queue for this repo. */
	openFlags: z.number(),
	stars: z.number(),
});
export type Repo = z.infer<typeof repoSchema>;

export const githubIntegrationSchema = z.object({
	accounts: z.array(githubAccountSchema),
	repos: z.array(repoSchema),
});
export type GithubIntegration = z.infer<typeof githubIntegrationSchema>;
