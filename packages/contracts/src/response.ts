import { z } from "zod";
import type { Verdict } from "./runs.ts";

/**
 * Per-repo response config — what tripwire SAYS and DOES when a verdict lands
 * (the /customize surface). Stored as jsonb in `response_configs`, validated
 * here on write and re-parsed on read. An absent row resolves to
 * `DEFAULT_RESPONSE_CONFIG`, and the block-comment default is `full` mode, so a
 * repo that never touches customize gets identical comments to before this
 * config existed.
 */

/** What surfaces on a passing verdict: nothing, the check alone, or both. */
export const successSurfaceSchema = z.enum(["silent", "ci-check", "comment"]);
export type SuccessSurface = z.infer<typeof successSurfaceSchema>;

/** Comment on/off for a verdict whose check always posts. */
export const commentSurfaceSchema = z.enum(["comment", "silent"]);
export type CommentSurface = z.infer<typeof commentSurfaceSchema>;

/**
 * The block comment's shape:
 * - `full` — the complete comment: reasons, button, collapsibles.
 * - `one-liner-link` — one rule one-liner per failed rule, then the run button.
 * - `link-only` — the verdict line and the run button.
 * - `custom` — the maintainer's template; vars `{{ruleName}}` `{{runUrl}}`.
 */
export const blockCommentModeSchema = z.enum([
	"full",
	"one-liner-link",
	"link-only",
	"custom",
]);
export type BlockCommentMode = z.infer<typeof blockCommentModeSchema>;

export const blockCommentConfigSchema = z.object({
	mode: blockCommentModeSchema.default("full"),
	/** one-liner-link mode: prefix each line with the rule's display name. */
	showRuleName: z.boolean().default(true),
	/** custom mode only. `{{ruleName}}` resolves to the rule's contributor label. */
	template: z.string().max(4000).default(""),
});
export type BlockCommentConfig = z.infer<typeof blockCommentConfigSchema>;

export const responseConfigSchema = z.object({
	onSuccess: successSurfaceSchema.default("ci-check"),
	onBlock: commentSurfaceSchema.default("comment"),
	blockComment: blockCommentConfigSchema.prefault({}),
	/** The needs_review verdict — "sent to review" in every user-facing surface. */
	moderationQueued: commentSurfaceSchema.default("comment"),
});
export type ResponseConfig = z.infer<typeof responseConfigSchema>;

export const DEFAULT_RESPONSE_CONFIG: ResponseConfig =
	responseConfigSchema.parse({});

/**
 * Whether a COMMENT surfaces for this verdict under the config. The worker adds
 * one override on top: a verdict TRANSITION always writes the comment, so a
 * stale "blocked" comment can never outlive its verdict (§7).
 */
export function wantsComment(
	config: ResponseConfig,
	verdict: Verdict,
): boolean {
	if (verdict === "pass") {
		return config.onSuccess === "comment";
	}
	if (verdict === "block") {
		return config.onBlock === "comment";
	}
	return config.moderationQueued === "comment";
}

/**
 * Whether the CHECK posts for this verdict. Block and sent-to-review always
 * check — the check IS the merge gate. Only a silent-on-success repo skips the
 * pass check.
 */
export function wantsCheck(config: ResponseConfig, verdict: Verdict): boolean {
	return verdict !== "pass" || config.onSuccess !== "silent";
}
