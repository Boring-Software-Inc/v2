import { COMMENT_MARKER, type Verdict } from "@tripwire/contracts";
import type { GithubHttp } from "../client/http.ts";
import { supersededBody } from "../copy.ts";

/**
 * The comment's GitHub lifecycle (§7). The BODY is rendered upstream by
 * `@tripwire/contracts` (`renderCommentBody` / `renderVerdictComment` — moved
 * there so the web /customize preview shares the exact function); this file
 * owns the posting: locate the active comment by its hidden marker, edit in
 * place on a same verdict, supersede + post on a transition.
 */

interface IssueComment {
	id: number;
	body?: string;
}

/**
 * Verdict-aware upsert (§7). RUN HISTORY is the source of truth for what
 * happened: `previousVerdict` (the verdict the PR already shows) decides
 * edit-vs-transition — NEVER the comment thread. The marker is used ONLY to
 * LOCATE the active comment (superseding strips it, so there is at most one).
 *
 * - NOT a transition (same/first verdict) ⇒ edit the active comment in place;
 *   if it's gone (a human deleted it), post a fresh one. Ten broken pushes are
 *   one comment, ten edits, zero thread noise.
 * - `onlyIfPresent` ⇒ touch the thread only when an active comment exists.
 * - a TRANSITION ⇒ post a NEW comment after the contributor's commit, and
 *   supersede the old one IF it's still there. If the old comment was deleted or
 *   edited away, there is nothing to supersede — post the resolution anyway
 *   (run history knows it's a transition), unless `onlyIfPresent` is set.
 */
export async function upsertComment(
	http: GithubHttp,
	repoFullName: string,
	number: number,
	body: string,
	verdict: Verdict,
	previousVerdict: Verdict | null,
	onlyIfPresent = false,
): Promise<{
	externalId: string | null;
	created: boolean;
	supersededId: string | null;
}> {
	const active = await findActiveComment(http, repoFullName, number);
	if (!active && onlyIfPresent) {
		return { externalId: null, created: false, supersededId: null };
	}

	const post = async (
		supersededId: string | null,
	): Promise<{
		externalId: string;
		created: boolean;
		supersededId: string | null;
	}> => {
		const created = (await http.post(
			repoFullName,
			`/repos/${repoFullName}/issues/${number}/comments`,
			{ body },
		)) as IssueComment;
		return { externalId: String(created.id), created: true, supersededId };
	};

	const transition = previousVerdict !== null && previousVerdict !== verdict;

	if (!transition) {
		// Same/first verdict: edit the active comment, or post a fresh one if a
		// human deleted it.
		if (!active) {
			return await post(null);
		}
		await http.patch(
			repoFullName,
			`/repos/${repoFullName}/issues/comments/${active.id}`,
			{ body },
		);
		return {
			externalId: String(active.id),
			created: false,
			supersededId: null,
		};
	}

	// Transition: supersede the old comment if it's still there, then post new.
	if (active) {
		await http.patch(
			repoFullName,
			`/repos/${repoFullName}/issues/comments/${active.id}`,
			{ body: supersededBody(active.body ?? "") },
		);
		return await post(String(active.id));
	}
	return await post(null);
}

async function findActiveComment(
	http: GithubHttp,
	repoFullName: string,
	number: number,
): Promise<IssueComment | undefined> {
	const comments = (await http.get(
		repoFullName,
		`/repos/${repoFullName}/issues/${number}/comments?per_page=100`,
	)) as IssueComment[];
	return [...comments].reverse().find((c) => c.body?.includes(COMMENT_MARKER));
}

export async function deleteActiveComment(
	http: GithubHttp,
	repoFullName: string,
	number: number,
): Promise<string | null> {
	const active = await findActiveComment(http, repoFullName, number);
	if (!active) {
		return null;
	}
	try {
		await http.delete(
			repoFullName,
			`/repos/${repoFullName}/issues/comments/${active.id}`,
		);
	} catch (error) {
		if (error instanceof Error && error.message.includes(" failed: 404 ")) {
			return null;
		}
		throw error;
	}
	return String(active.id);
}
