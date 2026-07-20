import type { Verdict } from "@tripwire/contracts";
import type { GithubHttp } from "../client/http.ts";
import {
	BUTTON_ALT,
	type CommentReason,
	commentHeadline,
	howDoIFix,
	RERUN_NOTE,
	reasonsBlock,
	supersededBody,
	WHAT_IS_TRIPWIRE,
} from "../copy.ts";

/**
 * THE comment (§7): the verdict line, the failing rules' plain-English reasons,
 * the "View on Tripwire" run button (VISIBLE — the run page is the contributor's
 * appeal surface, §10), and collapsible "how do i fix this?" / "what is tripwire?"
 * blocks. The hidden marker makes subsequent events EDIT the comment (upsert) —
 * tripwire never litters a thread.
 *
 * The button is a hosted PNG (the dithered Geist-Pixel design) wrapped in a
 * link — GitHub comments render only a safe HTML subset, so a shader/font
 * button can't live inline; the image is verdict-neutral and the bold verdict
 * line above carries the meaning. Served by the web head at
 * `${appUrl}/badges/view-run.png`.
 */

/** Stable identifier in EVERY live tripwire comment (also drives `byTripwire`). */
export const COMMENT_MARKER = "<!-- tripwire:run -->";
export const BADGE_PATH = "/badges/view-run.png";
/** The button's intrinsic 1x design width — the 3x asset renders crisp. */
const BADGE_WIDTH = 185;

export interface CommentInput {
	verdict: Verdict;
	/** The contributor, @-mentioned on blocked + sent-to-review. */
	contributorLogin: string;
	/** The failing rules' reasons (block only); empty for pass / needs_review. */
	reasons: CommentReason[];
	runUrl: string;
	/** Absolute URL to the button PNG (`${appUrl}${BADGE_PATH}`). */
	badgeUrl: string;
	/** Fail-closed floor fired — the headline names the degradation. */
	degraded?: boolean;
	/** The active comment's verdict — drives the resolution headline (§7). */
	previousVerdict?: Verdict | null;
	/** Manual re-run: adds the quiet re-evaluation note under the headline. */
	rerun?: boolean;
}

export function renderCommentBody(input: CommentInput): string {
	const button = `<a href="${input.runUrl}"><img src="${input.badgeUrl}" width="${BADGE_WIDTH}" alt="${BUTTON_ALT}" /></a>`;
	const headline = commentHeadline(input.verdict, input.contributorLogin, {
		degraded: input.degraded,
		previousVerdict: input.previousVerdict,
	});
	const lines: string[] = [headline, ""];
	if (input.rerun) {
		lines.push(RERUN_NOTE, "");
	}
	if (input.verdict === "block") {
		lines.push(reasonsBlock(input.reasons), "", button, "");
		lines.push(howDoIFix(input.reasons), "", WHAT_IS_TRIPWIRE);
	} else if (input.verdict === "needs_review") {
		lines.push(button, "", WHAT_IS_TRIPWIRE);
	} else {
		lines.push(button);
	}
	lines.push(COMMENT_MARKER, "");
	return lines.join("\n");
}

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
 * - a TRANSITION ⇒ post a NEW comment after the contributor's commit, and
 *   supersede the old one IF it's still there. If the old comment was deleted or
 *   edited away, there is nothing to supersede — post the resolution anyway
 *   (run history knows it's a transition), never silently a "first verdict".
 */
export async function upsertComment(
	http: GithubHttp,
	repoFullName: string,
	number: number,
	body: string,
	verdict: Verdict,
	previousVerdict: Verdict | null,
): Promise<{
	externalId: string;
	created: boolean;
	supersededId: string | null;
}> {
	const comments = (await http.get(
		repoFullName,
		`/repos/${repoFullName}/issues/${number}/comments?per_page=100`,
	)) as IssueComment[];
	// The active comment is the LAST one still carrying the marker.
	const active = [...comments]
		.reverse()
		.find((c) => c.body?.includes(COMMENT_MARKER));

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
