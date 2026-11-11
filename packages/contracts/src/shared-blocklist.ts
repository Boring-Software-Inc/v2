import { z } from "zod";
import type { EventKind } from "./events.ts";

export const SHARED_BLOCKLIST_RULE_ID = "shared-spam-blocklist";
export const SHARED_BLOCKLIST_RULE_VERSION = 2;
export const PILOT_TRIGGER_KINDS: readonly EventKind[] = [
	"change-request.opened",
	"issue.opened",
];
export const SHARED_BLOCKLIST_RULE_REF = `${SHARED_BLOCKLIST_RULE_ID}@${SHARED_BLOCKLIST_RULE_VERSION}`;
export const SHARED_BLOCKLIST_REPOSITORY =
	"https://github.com/Boring-Software-Inc/Pilot";
export const SHARED_BLOCKLIST_API_PATH = "/api/blocklist";
export const SHARED_BLOCKLIST_SOURCE =
	"https://raw.githubusercontent.com/Boring-Software-Inc/Pilot/published/snapshot.json";
export const SHARED_BLOCKLIST_STAGING_SOURCE =
	"https://raw.githubusercontent.com/Boring-Software-Inc/Pilot/published-staging/snapshot.json";
export const SHARED_BLOCKLIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const accountId = z.string().regex(/^[1-9][0-9]*$/);
const entry = z.strictObject({
	accountId,
	login: z.string().min(1).max(100),
	reason: z.string().trim().min(1).max(300),
	expiresAt: z.iso.datetime().nullable().default(null),
});

export const sharedBlocklistSnapshotSchema = z
	.strictObject({
		version: z.literal(1),
		revision: z.int().positive(),
		publishedAt: z.iso.datetime(),
		entries: z.array(entry).max(10_000),
	})
	.refine(
		(snapshot) =>
			new Set(snapshot.entries.map((item) => item.accountId)).size ===
			snapshot.entries.length,
		"Duplicate account IDs",
	);

export const sharedBlocklistPageQuerySchema = z.object({
	q: z.string().trim().max(100).optional().catch(undefined),
	page: z.coerce.number().int().min(1).max(400).optional().catch(undefined),
});

export const sharedBlocklistRuleConfigSchema = z.strictObject({});

export const sharedBlocklistMatchSchema = z.strictObject({
	accountId,
	reason: entry.shape.reason,
	revision: z.int().positive(),
});

/** Evidence records the snapshot checked and, for a match, the account and listing reason. */
export const sharedBlocklistEvidenceSchema = z.union([
	sharedBlocklistMatchSchema,
	sharedBlocklistMatchSchema.pick({ revision: true }),
]);
export type SharedBlocklistEvidence = z.infer<
	typeof sharedBlocklistEvidenceSchema
>;

export type SharedBlocklistSnapshot = z.infer<
	typeof sharedBlocklistSnapshotSchema
>;

export const staffBlocklistAdditionSchema = z.strictObject({
	login: z
		.string()
		.trim()
		.regex(/^[a-z\d](?:[a-z\d-]{0,98}[a-z\d])?$/i),
	reason: entry.shape.reason,
	expiresAt: entry.shape.expiresAt,
});

export const blocklistGitHubAccountSchema = z.object({
	id: z.int().positive(),
	login: staffBlocklistAdditionSchema.shape.login,
});

export const blocklistDispatchResponseSchema = z.object({
	workflow_run_id: z.int().positive(),
});

export const blocklistGitHubRepositorySchema = z.object({
	stargazers_count: z.int().nonnegative(),
});
