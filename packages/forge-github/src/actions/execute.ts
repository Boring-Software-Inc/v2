import type { ForgeAction, ForgeActionResult } from "@tripwire/forge";
import type { GithubHttp } from "../client/http.ts";
import { DISMISS_REVIEW_MESSAGE } from "../copy.ts";
import { setCheck } from "./check.ts";
import { upsertComment } from "./comment.ts";

/**
 * Executes a ForgeAction idempotently (§4). `block` files a request-changes
 * review so unprotected repos still get friction; the failing `tripwire`
 * check remains the primary gate (§7 — required status ⇒ dead merge button).
 * Closing PRs is not tripwire's job. Comment and check upsert their artifact.
 * Review submission is best-effort at the caller: GitHub legally 403s
 * request-changes on your own PRs.
 */
export async function executeAction(
	http: GithubHttp,
	action: ForgeAction,
): Promise<ForgeActionResult> {
	switch (action.kind) {
		case "block": {
			const review = (await http.post(
				action.repoFullName,
				`/repos/${action.repoFullName}/pulls/${action.number}/reviews`,
				{ event: "REQUEST_CHANGES", body: action.reason },
			)) as { id?: number };
			return { externalId: review.id ? String(review.id) : null };
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
			);
			return { externalId: result.externalId };
		}
		case "dismiss-review": {
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
		default: {
			action satisfies never;
			return { externalId: null };
		}
	}
}
