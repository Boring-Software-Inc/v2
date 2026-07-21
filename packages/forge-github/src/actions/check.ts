import { CHECK_NAME, type CheckState } from "@tripwire/contracts";
import type { GithubHttp } from "../client/http.ts";

/**
 * The merge gate (§7): ONE check run named `tripwire` per head SHA, emitted
 * App-side via the Checks API — never a workflow file in the customer's repo.
 * Re-run of the same SHA UPDATES the existing check (upsert); a new push is a
 * new SHA and gets a fresh check by GitHub semantics.
 */

interface CheckRun {
	id: number;
}

function toApiFields(state: CheckState) {
	if (state.conclusion === "pending") {
		return {
			status: "in_progress" as const,
			conclusion: undefined,
		};
	}
	return { status: "completed" as const, conclusion: state.conclusion };
}

export async function setCheck(
	http: GithubHttp,
	repoFullName: string,
	state: CheckState,
): Promise<{ externalId: string; created: boolean }> {
	const { status, conclusion } = toApiFields(state);
	const payload = {
		name: CHECK_NAME,
		head_sha: state.sha,
		status,
		...(conclusion ? { conclusion } : {}),
		details_url: state.detailsUrl,
		output: {
			title: state.summary.split("—")[0]?.trim() ?? CHECK_NAME,
			summary: state.summary,
		},
	};

	const existing = (await http.get(
		repoFullName,
		`/repos/${repoFullName}/commits/${state.sha}/check-runs?check_name=${CHECK_NAME}&filter=latest`,
	)) as { check_runs?: CheckRun[] };
	const found = existing.check_runs?.[0];
	if (found) {
		await http.patch(
			repoFullName,
			`/repos/${repoFullName}/check-runs/${found.id}`,
			payload,
		);
		return { externalId: String(found.id), created: false };
	}
	const created = (await http.post(
		repoFullName,
		`/repos/${repoFullName}/check-runs`,
		payload,
	)) as CheckRun;
	return { externalId: String(created.id), created: true };
}
