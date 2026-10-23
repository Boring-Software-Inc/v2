import { CHECK_NAME, type CheckState } from "@tripwire/contracts";
import { z } from "zod";
import type { GithubHttp } from "../client/http.ts";

/**
 * The merge gate (§7): ONE check run named `tripwire` per head SHA, emitted
 * App-side via the Checks API — never a workflow file in the customer's repo.
 * Re-run of the same SHA UPDATES the newest own check (upsert), except a
 * pending state over a completed check: GitHub never reopens a completed
 * check, so that posts a new one. A new push is a new SHA and a fresh check.
 */

const checkRunSchema = z.object({
	id: z.number(),
	app: z.object({ id: z.number() }).nullish(),
});

const listedCheckRunSchema = checkRunSchema.extend({ status: z.string() });

const checkRunListSchema = z.object({
	check_runs: z.array(listedCheckRunSchema).default([]),
});

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
			title:
				state.summary.split(". ")[0]?.replace(/\.$/, "").trim() || CHECK_NAME,
			summary: state.summary,
		},
	};

	const existing = checkRunListSchema.parse(
		await http.get(
			repoFullName,
			`/repos/${repoFullName}/commits/${state.sha}/check-runs?check_name=${CHECK_NAME}&app_id=${http.appId}&filter=all&per_page=100`,
		),
	);
	const found = existing.check_runs
		.filter((run) => run.app?.id === http.appId)
		.reduce<z.infer<typeof listedCheckRunSchema> | null>(
			(newest, run) => (newest && newest.id > run.id ? newest : run),
			null,
		);
	const reopensCompleted =
		status !== "completed" && found?.status === "completed";
	if (found && !reopensCompleted) {
		await http.patch(
			repoFullName,
			`/repos/${repoFullName}/check-runs/${found.id}`,
			payload,
		);
		return { externalId: String(found.id), created: false };
	}
	const created = checkRunSchema.parse(
		await http.post(repoFullName, `/repos/${repoFullName}/check-runs`, payload),
	);
	return { externalId: String(created.id), created: true };
}
