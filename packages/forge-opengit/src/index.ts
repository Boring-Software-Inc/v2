/**
 * @tripwire/forge-opengit — the open-git adapter: inbound + actions, no reads.
 *
 * open-git's v1 API has no diff, commits, contents or users endpoint, so the
 * four read methods throw rather than fabricate (see `adapter.ts`) and the
 * worker resolves this forge with `reads: null`. What is real: verified
 * ingest, and the `tripwire` check — which on open-git is the entire merge
 * gate, since its merge path consults checks and nothing else.
 *
 * It never imports a sibling adapter (§3), including for the signature scheme
 * and JWT flow it happens to share with GitHub.
 */
export { createOpenGitAdapter } from "./adapter.ts";
export {
	createBotJwt,
	OPEN_GIT_API_BASE,
	type OpenGitBotCredentials,
	OpenGitTokenCache,
} from "./client/auth.ts";
export { OpenGitHttp, type OpenGitHttpOptions } from "./client/http.ts";
export {
	listInstallationRepos,
	type OpenGitInstallationRepo,
} from "./client/installation.ts";
export { normalizeWebhook } from "./webhook/normalize.ts";
export { signWebhookBody, verifyWebhookSignature } from "./webhook/verify.ts";
