import { CHECK_NAME, type CheckState } from "@tripwire/contracts";
import type { OpenGitHttp } from "../client/http.ts";

/**
 * The merge gate (§7) on open-git: ONE check named `tripwire` per head SHA.
 * `POST /commits/{sha}/checks` upserts by name, so a re-run of the same SHA
 * updates in place and a new push gets a fresh check — no read-then-write, and
 * no way to double-post.
 *
 * open-git's gate is BINARY: `mergePullRequestForActor` consults
 * `getPullRequestCheckGate` and nothing else, and any status other than
 * `success` blocks merge. There is no advisory state, which decides the
 * `neutral` mapping below.
 */

interface OpenGitCheckRun {
	id: string;
}

type OpenGitStatus = "queued" | "running" | "success" | "failed" | "canceled";

/**
 * `needs_review` arrives here as `pending`, so it stays `running` until a
 * maintainer decides. `neutral` has no non-blocking open-git status, so it
 * maps to `failed`, the fail-closed direction.
 */
const CONCLUSION_TO_STATUS = {
	success: "success",
	failure: "failed",
	neutral: "failed",
	pending: "running",
} satisfies Record<CheckState["conclusion"], OpenGitStatus>;

export async function setCheck(
	http: OpenGitHttp,
	repoFullName: string,
	state: CheckState,
): Promise<{ externalId: string | null }> {
	const created = (await http.post(
		repoFullName,
		`/api/v1/repos/${repoFullName}/commits/${state.sha}/checks`,
		{
			name: CHECK_NAME,
			status: CONCLUSION_TO_STATUS[state.conclusion],
			// open-git caps summary at 2000 characters and rejects the whole write
			// past it, so a long verdict is trimmed rather than dropped.
			summary: state.summary.slice(0, 2000),
			detailsUrl: state.detailsUrl,
		},
	)) as OpenGitCheckRun | null;
	return { externalId: created?.id ?? null };
}
