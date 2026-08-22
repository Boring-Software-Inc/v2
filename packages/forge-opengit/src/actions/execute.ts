import type { ForgeAction, ForgeActionResult } from "@tripwire/forge";
import type { OpenGitHttp } from "../client/http.ts";
import { setCheck } from "./check.ts";

/**
 * Executes a ForgeAction on open-git (§4). The check is the WHOLE gate here,
 * and that is not a limitation being worked around — it is what open-git does:
 * `mergePullRequestForActor` blocks on `getPullRequestCheckGate` and consults
 * no reviews, so a failing `tripwire` check is a dead merge button on every
 * repo, with no branch protection to opt into.
 *
 * That is why `block` does NOT file a changes-requested review the way the
 * GitHub adapter does. On GitHub the review is friction for repos without
 * required checks. Here it would gate nothing, and open-git exposes no
 * dismissal endpoint — so it would sit on the change request forever after the
 * block clears. A stale, undismissable review is worse than none; the check
 * already says the same thing and clears itself on the next upsert.
 *
 * Everything else throws. open-git has no labels, no comment upsert (its
 * comments endpoint is create-only — no list, no patch — so honouring "upsert,
 * never append" is impossible), no reviewer requests and no dismissals.
 * Throwing is deliberate: `block` and `dismiss-review` are best-effort at the
 * caller and settle with a warning, while the rest stay recorded rather than
 * being marked executed. Silently returning success would put an action in the
 * audit trail that never happened.
 */
export async function executeAction(
	http: OpenGitHttp,
	action: ForgeAction,
): Promise<ForgeActionResult> {
	switch (action.kind) {
		case "set-check": {
			return await setCheck(http, action.repoFullName, action.check);
		}
		case "block":
		case "dismiss-review": {
			throw new Error(
				`open-git gates on checks alone — ${action.kind} is not executed; the tripwire check is the gate`,
			);
		}
		case "comment": {
			throw new Error(
				"open-git exposes no comment list or update endpoint, so a comment cannot be upserted (§7)",
			);
		}
		case "label": {
			throw new Error("open-git exposes no label endpoint");
		}
		case "request-review": {
			throw new Error("open-git exposes no reviewer-request endpoint");
		}
		default: {
			action satisfies never;
			return { externalId: null };
		}
	}
}
