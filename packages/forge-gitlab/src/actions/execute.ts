import {
	CHECK_NAME,
	type CheckState,
	COMMENT_MARKER,
} from "@tripwire/contracts";
import type { ForgeAction, ForgeActionResult } from "@tripwire/forge";
import { encodeProject, type GitlabHttp } from "../client/http.ts";
import { supersededBody } from "../copy.ts";

/**
 * Execute a ForgeAction on GitLab. Every action is idempotent (§4).
 *
 * The forge primitives differ from GitHub:
 *   - `set-check`  -> a commit status (`POST /statuses/:sha`). This is the merge
 *                     gate. GitLab holds the merge button when a required status
 *                     is not `success`.
 *   - `block`      -> an unresolved discussion thread. GitLab has no
 *                     "request changes" review. An open thread blocks merge when
 *                     the project requires all threads to be resolved. This is
 *                     the closest analog.
 *   - `comment`    -> a merge-request note, found by marker and upserted.
 *   - `label`      -> `add_labels` on the merge request.
 */
export async function executeAction(
	http: GitlabHttp,
	action: ForgeAction,
): Promise<ForgeActionResult> {
	const project = encodeProject(action.repoFullName);
	switch (action.kind) {
		case "set-check": {
			return setCommitStatus(http, action.repoFullName, action.check);
		}
		case "block": {
			// Open an unresolved thread with the reason.
			const thread = (await http.post(
				action.repoFullName,
				`/projects/${project}/merge_requests/${action.number}/discussions`,
				{ body: action.reason },
			)) as { id?: string };
			return { externalId: thread.id ? String(thread.id) : null };
		}
		case "dismiss-review": {
			// The block cleared. Resolve the tripwire thread so it stops gating merge.
			// `reviewId` is the discussion id from the `block` action.
			await http.put(
				action.repoFullName,
				`/projects/${project}/merge_requests/${action.number}/discussions/${action.reviewId}?resolved=true`,
				{},
			);
			return { externalId: action.reviewId };
		}
		case "label": {
			await http.put(
				action.repoFullName,
				`/projects/${project}/merge_requests/${action.number}`,
				{ add_labels: action.labels.join(",") },
			);
			return { externalId: null };
		}
		case "comment": {
			const result = await upsertNote(
				http,
				action.repoFullName,
				action.number,
				action.body,
				action.previousVerdict !== null &&
					action.previousVerdict !== action.verdict,
			);
			return { externalId: result.externalId };
		}
		case "request-review": {
			// TODO: GitLab sets reviewers by user id (`reviewer_ids`). The action
			// carries no reviewer, so this is a no-op for the PoC.
			return { externalId: null };
		}
		default: {
			action satisfies never;
			return { externalId: null };
		}
	}
}

/** The merge gate. A GitLab commit status is idempotent per (sha, name). */
async function setCommitStatus(
	http: GitlabHttp,
	repoFullName: string,
	check: CheckState,
): Promise<ForgeActionResult> {
	const project = encodeProject(repoFullName);
	const state = toGitlabState(check.conclusion);
	const created = (await http.post(
		repoFullName,
		`/projects/${project}/statuses/${check.sha}`,
		{
			state,
			name: CHECK_NAME,
			description: check.summary,
			target_url: check.detailsUrl,
		},
	)) as { id?: number };
	return { externalId: created.id ? String(created.id) : null };
}

/** Map the neutral check conclusion to a GitLab commit-status state. */
function toGitlabState(conclusion: CheckState["conclusion"]): string {
	switch (conclusion) {
		case "success":
			return "success";
		case "failure":
			return "failed";
		case "pending":
			return "running";
		default:
			// `neutral` does not block. A success keeps the merge button open.
			return "success";
	}
}

interface Note {
	id: number;
	body?: string;
}

/**
 * Upsert Tripwire's note (§7). Find the active note by its marker. On the same
 * verdict, edit it in place. On a transition, supersede the old note and post a
 * new one. This mirrors the GitHub comment lifecycle.
 */
async function upsertNote(
	http: GitlabHttp,
	repoFullName: string,
	number: number,
	body: string,
	transition: boolean,
): Promise<{ externalId: string; created: boolean }> {
	const project = encodeProject(repoFullName);
	const notes = (await http.get(
		repoFullName,
		`/projects/${project}/merge_requests/${number}/notes?per_page=100`,
	)) as Note[];
	const active = [...notes]
		.reverse()
		.find((n) => n.body?.includes(COMMENT_MARKER));

	const post = async (): Promise<{ externalId: string; created: boolean }> => {
		const created = (await http.post(
			repoFullName,
			`/projects/${project}/merge_requests/${number}/notes`,
			{ body },
		)) as { id: number };
		return { externalId: String(created.id), created: true };
	};

	if (!transition) {
		if (!active) {
			return post();
		}
		await http.put(
			repoFullName,
			`/projects/${project}/merge_requests/${number}/notes/${active.id}`,
			{ body },
		);
		return { externalId: String(active.id), created: false };
	}

	// Transition: supersede the old note if it is still there, then post a new one.
	if (active) {
		await http.put(
			repoFullName,
			`/projects/${project}/merge_requests/${number}/notes/${active.id}`,
			{ body: supersededBody(active.body ?? "") },
		);
	}
	return post();
}
