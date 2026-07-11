import type { ForgeAction, ForgeActionResult } from "@tripwire/forge";
import type { GithubHttp } from "../client/http.ts";
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
			);
			return { externalId: result.externalId };
		}
		case "request-review": {
			await http.post(
				action.repoFullName,
				`/repos/${action.repoFullName}/pulls/${action.number}/requested_reviewers`,
				{},
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
