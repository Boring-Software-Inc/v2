/**
 * @tripwire/forge-github — the GitHub adapter. Inbound (verify + normalize)
 * landed with ingest (step 3); reads and actions land with the executor and
 * the PR surface. Never imports a sibling adapter.
 */
export { CHECK_NAME, setCheck } from "./actions/check.ts";
export {
	COMMENT_MARKER,
	renderCommentBody,
	upsertComment,
} from "./actions/comment.ts";
export { executeAction } from "./actions/execute.ts";
export { createGithubAdapter } from "./adapter.ts";
export {
	createAppJwt,
	type GithubAppCredentials,
	InstallationTokenCache,
} from "./client/auth.ts";
export { GithubHttp, type GithubHttpOptions } from "./client/http.ts";
export { GithubReads, type GithubReadsOptions } from "./client/reads.ts";
export {
	BUTTON_ALT,
	checkSummary,
	MAINTAINER_INTRO,
	MAINTAINER_SUMMARY,
	PENDING_CHECK_SUMMARY,
	REVIEW_BODY,
	VERDICT_WORD,
	verdictHeadline,
	verdictSentence,
} from "./copy.ts";
export { normalizeWebhook } from "./webhook/normalize.ts";
export { signWebhookBody, verifyWebhookSignature } from "./webhook/verify.ts";
