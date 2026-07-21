/**
 * The GitHub-side remainder of the bot's copy: the comment lifecycle strings
 * (supersede, review dismissal) and the pending-check line. The comment body's
 * render layer AND the check/review copy (`renderCommentBody`, `checkSummary`,
 * `reviewBody`, `CHECK_NAME`) moved to `@tripwire/contracts` (customize build
 * step) so the web preview renders the exact strings the worker posts; this
 * file keeps what only the adapter speaks. Same constitution governs both
 * halves (`.claude/rules/constitution.md`).
 */

/**
 * A superseded comment (§7): the human text of the old verdict, struck through,
 * pointing at the newer comment below. The button + collapsibles + markers are
 * dropped (everything from the first HTML block on) — a struck-through button is
 * noise. Losing the marker also means the superseded comment is no longer the
 * "active" tripwire comment: exactly one live comment carries the marker.
 */
export function supersededBody(originalBody: string): string {
	const htmlAt = originalBody.search(/<a |<details/);
	const kept = (
		htmlAt >= 0 ? originalBody.slice(0, htmlAt) : originalBody
	).trim();
	const struck = kept
		.split("\n")
		.map((line) => (line.trim() ? `~~${line}~~` : line))
		.join("\n");
	return `${struck}\n\nsuperseded — see the newer check below.`;
}

/** The message stamped on a dismissed request-changes review (§7). */
export const DISMISS_REVIEW_MESSAGE =
	"cleared — this change now passes tripwire's checks.";

/** The `pending` check emitted while evaluation is in flight (§5.6b). */
export const PENDING_CHECK_SUMMARY =
	"tripwire is evaluating this change request.";
