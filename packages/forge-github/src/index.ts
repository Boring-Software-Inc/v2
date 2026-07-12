/**
 * @tripwire/forge-github — the GitHub adapter. Inbound (verify + normalize)
 * landed with ingest (step 3); reads and actions land with the executor and
 * the PR surface. Never imports a sibling adapter.
 */
export { CHECK_NAME, setCheck } from "./actions/check.ts";
export {
	COMMENT_MARKER,
	type CommentInput,
	renderCommentBody,
	upsertComment,
} from "./actions/comment.ts";
export { executeAction } from "./actions/execute.ts";
export { createGithubAdapter } from "./adapter.ts";
export {
	checkAppCredentials,
	createAppJwt,
	type GithubAppCredentials,
	InstallationTokenCache,
} from "./client/auth.ts";
export { GithubHttp, type GithubHttpOptions } from "./client/http.ts";
export { GithubReads, type GithubReadsOptions } from "./client/reads.ts";
export {
	BUTTON_ALT,
	type CommentReason,
	checkSummary,
	commentHeadline,
	howDoIFix,
	PENDING_CHECK_SUMMARY,
	type Remedy,
	reasonsBlock,
	reviewBody,
	VERDICT_WORD,
	WHAT_IS_TRIPWIRE,
} from "./copy.ts";
export { normalizeWebhook } from "./webhook/normalize.ts";
export { signWebhookBody, verifyWebhookSignature } from "./webhook/verify.ts";
