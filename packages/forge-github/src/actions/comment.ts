import type { Verdict } from "@tripwire/contracts";
import type { GithubHttp } from "../client/http.ts";
import {
	BUTTON_ALT,
	MAINTAINER_INTRO,
	MAINTAINER_SUMMARY,
	verdictHeadline,
} from "../copy.ts";

/**
 * THE condensed comment (§7): verdict line + ONE sentence + the "View on
 * Tripwire" button deep-linking the run page. The hidden marker makes
 * subsequent events EDIT the comment (upsert) — tripwire never litters a
 * thread.
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
	/** ONE sentence of context — the presenter enforces it stays one line. */
	sentence: string;
	runUrl: string;
	/** Absolute URL to the button PNG (`${appUrl}${BADGE_PATH}`). */
	badgeUrl: string;
}

export function renderCommentBody(input: CommentInput): string {
	const sentence = input.sentence.replaceAll(/\s+/g, " ").trim();
	const button = `<a href="${input.runUrl}"><img src="${input.badgeUrl}" width="${BADGE_WIDTH}" alt="${BUTTON_ALT}" /></a>`;
	return [
		`${verdictHeadline(input.verdict)} — ${sentence}`,
		"",
		`<details><summary>${MAINTAINER_SUMMARY}</summary>`,
		"",
		MAINTAINER_INTRO,
		"",
		button,
		"",
		"</details>",
		COMMENT_MARKER,
		"",
	].join("\n");
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
