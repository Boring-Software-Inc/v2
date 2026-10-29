import type { ForgeAction, ForgeActionResult } from "@tripwire/forge";
import { type GithubHttp, GithubHttpError } from "../client/http.ts";
import { DISMISS_REVIEW_MESSAGE } from "../copy.ts";
import { setCheck } from "./check.ts";
import { deleteActiveComment, upsertComment } from "./comment.ts";
import {
	isOwnMarkedComment,
	issueCommentListSchema,
	issueCommentSchema,
} from "./ownership.ts";

/**
 * Executes a ForgeAction idempotently (§4). `block` files a request-changes
 * review so unprotected repos still get friction; the failing `tripwire`
 * check remains the primary gate (§7 — required status ⇒ dead merge button).
 * `block` never closes a PR; closing and locking happen only through the
 * explicit `close` and `lock` workflow actions, which use the issues API and
 * so work on issues and PRs alike. Comment and check upsert their artifact.
 * Review submission is best-effort at the caller: GitHub legally 403s
 * request-changes on your own PRs.
 */
export async function executeAction(
	http: GithubHttp,
	action: ForgeAction,
): Promise<ForgeActionResult> {
	switch (action.kind) {
		case "block": {
			return await requestChanges(
				http,
				action.repoFullName,
				action.number,
				action.reason,
			);
		}
		case "update-review": {
			return await updateReview(http, action);
		}
		case "label": {
			await http.post(
				action.repoFullName,
				`/repos/${action.repoFullName}/issues/${action.number}/labels`,
				{ labels: action.labels },
			);
			return { externalId: null };
		}
		case "comment": {
			const result = await upsertComment(
				http,
				action.repoFullName,
				action.number,
				action.body,
				action.verdict,
				action.previousVerdict,
				action.onlyIfPresent ?? false,
			);
			return { externalId: result.externalId };
		}
		case "delete-comment": {
			return {
				externalId: await deleteActiveComment(
					http,
					action.repoFullName,
					action.number,
				),
			};
		}
		case "dismiss-review": {
			if (action.reviewId === null)
				return { refused: true, reason: "unsupported-review-selection" };
			// The block clears ⇒ drop the stale request-changes review so it stops
			// gating merge. Idempotent: re-dismissing an already-dismissed review is
			// a harmless no-op the caller treats as best-effort.
			await http.put(
				action.repoFullName,
				`/repos/${action.repoFullName}/pulls/${action.number}/reviews/${action.reviewId}/dismissals`,
				{ message: DISMISS_REVIEW_MESSAGE, event: "DISMISS" },
			);
			return { externalId: action.reviewId };
		}
		case "request-review": {
			if (action.reviewerIds?.length)
				throw new Error(
					"GitHub review requests require GitHub usernames, not foreign actor IDs.",
				);
			if (action.reviewers.length === 0 && action.teamReviewers.length === 0) {
				throw new Error("request-review has no people or teams to ask.");
			}
			await http.post(
				action.repoFullName,
				`/repos/${action.repoFullName}/pulls/${action.number}/requested_reviewers`,
				{
					reviewers: action.reviewers,
					team_reviewers: action.teamReviewers,
				},
			);
			return { externalId: null };
		}
		case "set-check": {
			const result = await setCheck(http, action.repoFullName, action.check);
			return { externalId: result.externalId };
		}
		case "lock": {
			await http.put(
				action.repoFullName,
				`/repos/${action.repoFullName}/issues/${action.number}/lock`,
				action.reason ? { lock_reason: action.reason } : {},
			);
			return { externalId: null };
		}
		case "remove-label": {
			for (const label of action.labels) {
				await http
					.delete(
						action.repoFullName,
						`/repos/${action.repoFullName}/issues/${action.number}/labels/${encodeURIComponent(label)}`,
					)
					.catch((error: unknown) => {
						if (error instanceof GithubHttpError && error.status === 404) {
							return null;
						}
						throw error;
					});
			}
			return { externalId: null };
		}
		case "post-comment": {
			return await postActionComment(http, action);
		}
		case "close": {
			await http.patch(
				action.repoFullName,
				`/repos/${action.repoFullName}/issues/${action.number}`,
				{ state: "closed" },
			);
			return { externalId: null };
		}
		default: {
			action satisfies never;
			return { externalId: null };
		}
	}
}

const COMMENT_PAGES = 10;

async function postActionComment(
	http: GithubHttp,
	action: Extract<ForgeAction, { kind: "post-comment" }>,
): Promise<ForgeActionResult> {
	let path: string | null =
		`/repos/${action.repoFullName}/issues/${action.number}/comments?per_page=100`;
	for (let page = 0; path && page < COMMENT_PAGES; page++) {
		const result: { body: unknown; next: string | null } = await http.getPage(
			action.repoFullName,
			path,
		);
		const found = issueCommentListSchema
			.parse(result.body)
			.find((comment) =>
				isOwnMarkedComment(http.appId, comment, action.marker),
			);
		if (found) {
			return { externalId: String(found.id) };
		}
		path = result.next;
	}
	const created = issueCommentSchema.parse(
		await http.post(
			action.repoFullName,
			`/repos/${action.repoFullName}/issues/${action.number}/comments`,
			{ body: `${action.body}\n\n${action.marker}` },
		),
	);
	return { externalId: String(created.id) };
}

interface PullReview {
	id?: number;
	state?: string;
	body?: string;
}

async function requestChanges(
	http: GithubHttp,
	repoFullName: string,
	number: number,
	body: string,
): Promise<ForgeActionResult> {
	const review = (await http.post(
		repoFullName,
		`/repos/${repoFullName}/pulls/${number}/reviews`,
		{ event: "REQUEST_CHANGES", body },
	)) as PullReview;
	return { externalId: review.id ? String(review.id) : null };
}

async function updateReview(
	http: GithubHttp,
	action: Extract<ForgeAction, { kind: "update-review" }>,
): Promise<ForgeActionResult> {
	const path = `/repos/${action.repoFullName}/pulls/${action.number}/reviews/${action.reviewId}`;
	const current = (await http
		.get(action.repoFullName, path)
		.catch((error: Error) => {
			if (error.message.includes(" failed: 404 ")) {
				return null;
			}
			throw error;
		})) as PullReview | null;
	if (current?.state !== "CHANGES_REQUESTED") {
		return await requestChanges(
			http,
			action.repoFullName,
			action.number,
			action.reason,
		);
	}
	if (current.body !== action.reason) {
		await http.put(action.repoFullName, path, { body: action.reason });
	}
	return { externalId: action.reviewId };
}
