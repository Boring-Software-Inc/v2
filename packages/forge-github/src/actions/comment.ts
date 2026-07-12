import type { Verdict } from "@tripwire/contracts";
import type { GithubHttp } from "../client/http.ts";
import {
	BUTTON_ALT,
	type CommentReason,
	commentHeadline,
	howDoIFix,
	reasonsBlock,
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
}

export function renderCommentBody(input: CommentInput): string {
	const button = `<a href="${input.runUrl}"><img src="${input.badgeUrl}" width="${BADGE_WIDTH}" alt="${BUTTON_ALT}" /></a>`;
	const headline = commentHeadline(
		input.verdict,
		input.contributorLogin,
		input.degraded,
	);
	const lines: string[] = [headline, ""];
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
 * Upsert: find the marker comment on the thread and edit it; create only when
 * none exists. Idempotent by construction.
 */
export async function upsertComment(
	http: GithubHttp,
	repoFullName: string,
	number: number,
	body: string,
): Promise<{ externalId: string; created: boolean }> {
	const comments = (await http.get(
		repoFullName,
		`/repos/${repoFullName}/issues/${number}/comments?per_page=100`,
	)) as IssueComment[];
	const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
	if (existing) {
		await http.patch(
			repoFullName,
			`/repos/${repoFullName}/issues/comments/${existing.id}`,
			{ body },
		);
		return { externalId: String(existing.id), created: false };
	}
	const created = (await http.post(
		repoFullName,
		`/repos/${repoFullName}/issues/${number}/comments`,
		{ body },
	)) as IssueComment;
	return { externalId: String(created.id), created: true };
}
