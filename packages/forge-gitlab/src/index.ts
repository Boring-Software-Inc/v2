/**
 * @tripwire/forge-gitlab — the GitLab adapter (PoC). It implements the same
 * `ForgeAdapter` seam as `forge-github`: inbound (verify + normalize), reads,
 * and actions. It never imports a sibling adapter.
 *
 * GitLab maps cleanly to the seam:
 *   - merge request  -> change-request
 *   - note           -> comment
 *   - commit status  -> the merge-gate check (`set-check`)
 *   - labels         -> native merge-request labels
 * Onboarding uses OAuth, not a GitHub-style App installation. See `oauth.ts`.
 */
export { executeAction } from "./actions/execute.ts";
export { createGitlabAdapter } from "./adapter.ts";
export {
	encodeProject,
	GitlabHttp,
	type GitlabHttpOptions,
} from "./client/http.ts";
export { GitlabReads, type GitlabReadsOptions } from "./client/reads.ts";
export {
	exchangeGitlabCode,
	type GitlabOAuthConfig,
	type GitlabOAuthTokens,
	gitlabAuthorizeUrl,
	refreshGitlabToken,
} from "./oauth.ts";
export {
	type CreateProjectHookInput,
	createProjectHook,
	type GitlabOnboardingOptions,
	type GitlabProject,
	listMaintainedProjects,
} from "./onboarding.ts";
export { normalizeWebhook } from "./webhook/normalize.ts";
export { signWebhookBody, verifyWebhookSignature } from "./webhook/verify.ts";
