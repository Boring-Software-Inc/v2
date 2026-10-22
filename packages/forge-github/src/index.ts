/**
 * @tripwire/forge-github — the GitHub adapter. Inbound (verify + normalize)
 * landed with ingest (step 3); reads and actions land with the executor and
 * the PR surface. Never imports a sibling adapter.
 */
// The comment render layer moved to @tripwire/contracts (customize build step);
// re-exported here so existing worker imports keep resolving.
export {
	CHECK_NAME,
	COMMENT_MARKER,
	type CommentInput,
	type CommentReason,
	checkSummary,
	commentHeadline,
	type HeadlineOptions,
	howDoIFix,
	REVIEW_POINTER,
	type Remedy,
	RUN_LINK_TEXT,
	reasonsBlock,
	renderCommentBody,
	renderVerdictComment,
	VERDICT_WORD,
} from "@tripwire/contracts";
export { setCheck } from "./actions/check.ts";
export { upsertComment } from "./actions/comment.ts";
export { executeAction } from "./actions/execute.ts";
export { createGithubAdapter } from "./adapter.ts";
export {
	checkAppCredentials,
	createAppJwt,
	type GithubAppCredentials,
	InstallationTokenCache,
} from "./client/auth.ts";
export {
	GithubHttp,
	GithubHttpError,
	type GithubHttpOptions,
} from "./client/http.ts";
export {
	type GithubInstallation,
	type GithubInstallationRepo,
	GithubInstallations,
	type GithubInstallationsOptions,
	type UserInstallationAccess,
	type UserInstallationRepo,
} from "./client/installations.ts";
export { GithubReads, type GithubReadsOptions } from "./client/reads.ts";
export { listRepoReviewers } from "./client/reviewers.ts";
export { listThreads } from "./client/threads.ts";
export {
	DISMISS_REVIEW_MESSAGE,
	PENDING_CHECK_SUMMARY,
	supersededBody,
} from "./copy.ts";
export { type GithubForge, githubForge } from "./signals.ts";
export { normalizeWebhook } from "./webhook/normalize.ts";
export { signWebhookBody, verifyWebhookSignature } from "./webhook/verify.ts";
