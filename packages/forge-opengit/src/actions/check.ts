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
 * `needs_review` arrives here as `neutral`, and open-git has no non-blocking
 * non-success status. Blocking is the fail-closed direction and matches what
 * the verdict means — park the change request until a human decides — so it
 * maps to `failed` rather than quietly passing. This is a real behavioural
 * difference from GitHub, where `neutral` does not hold the merge button.
 */
const CONCLUSION_TO_STATUS: Record<CheckState["conclusion"], OpenGitStatus> = {
	success: "success",
	failure: "failed",
	neutral: "failed",
	pending: "running",
};

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
