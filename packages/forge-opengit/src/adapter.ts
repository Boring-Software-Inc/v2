import type {
	ContributorProfile,
	DiffFile,
	ForgeAction,
	ForgeActionResult,
	ForgeAdapter,
	ForgeCommit,
	RawForgeEvent,
} from "@tripwire/forge";
import { executeAction } from "./actions/execute.ts";
import { OpenGitHttp, type OpenGitHttpOptions } from "./client/http.ts";
import { normalizeWebhook } from "./webhook/normalize.ts";
import { verifyWebhookSignature } from "./webhook/verify.ts";

/**
 * The assembled open-git ForgeAdapter (§4): inbound + actions. The read half
 * is absent, and says so out loud.
 *
 * open-git's v1 API has no diff, commits, contents or users endpoint. The web
 * app does serve those (`/api/repos/:repoId/pulls/:prId/diff` and friends) but
 * they are session-authed browser routes keyed by internal uuid — an
 * installation token cannot reach them, so they are not a read surface.
 *
 * ── WHY THESE THROW RATHER THAN RETURN EMPTY ────────────────────────────────
 * An empty diff is a claim: "this change request touched no files". It would
 * make max-files-changed PASS and honeypot find nothing, turning an absent
 * read into a clean bill of health. Throwing degrades instead — the worker's
 * read guard catches it, records the degradation and the affected rules skip
 * (§6 fail-closed).
 *
 * In practice the worker never calls these: it resolves open-git with
 * `reads: null`, and every rule needing them declares `forges: ["github"]`.
 * They are the honest floor for anything that gets here another way.
 */

function noReadSurface(what: string): never {
	throw new Error(
		`open-git exposes no ${what} endpoint — this read is unavailable, not empty`,
	);
}

export function createOpenGitAdapter(
	options: OpenGitHttpOptions,
): ForgeAdapter {
	const http = new OpenGitHttp(options);
	return {
		forge: "opengit",
		verifyWebhook(event: RawForgeEvent, secret: string): boolean {
			return verifyWebhookSignature(event, secret);
		},
		normalizeWebhook(event: RawForgeEvent, receivedAt: string) {
			return normalizeWebhook(event, receivedAt);
		},
		getDiff(): Promise<DiffFile[]> {
			return noReadSurface("diff");
		},
		getCommits(): Promise<ForgeCommit[]> {
			return noReadSurface("commits");
		},
		readFile(): Promise<string | null> {
			return noReadSurface("contents");
		},
		getContributorProfile(): Promise<ContributorProfile> {
			return noReadSurface("users");
		},
		execute(action: ForgeAction): Promise<ForgeActionResult> {
			return executeAction(http, action);
		},
	};
}
