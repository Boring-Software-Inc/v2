import {
	COMMENT_MARKER,
	type EventKind,
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import type { RawForgeEvent } from "@tripwire/forge";
import { generateId } from "@tripwire/utils";
import { z } from "zod";

/**
 * Raw open-git payload → NormalizedEvent (§5.5/§5.6). Returns null for event
 * kinds Tripwire does not ingest; throws on a malformed payload of an ingested
 * kind, which the worker quarantines.
 *
 * open-git names map cleanly onto the neutral vocabulary:
 *   pull_request.opened      -> change-request.opened
 *   pull_request.edited      -> change-request.updated
 *   pull_request.synchronize -> change-request.updated
 *   pull_request.closed      -> change-request.closed
 *   pull_request.comment     -> comment.created
 *
 * `edited` (title/description changed, no new commits) is an UPDATE, not an
 * open: the head sha is unchanged, so anything keyed on the sha re-runs against
 * the same code while the title/body gates re-evaluate. It is the one event
 * that can flip english-only without a push.
 *
 * ── WHAT OPEN-GIT DOES NOT SEND ─────────────────────────────────────────────
 * The pull_request payload is `{id, number, author, title, body, head_sha}`.
 * There are no branch refs and no draft flag, and the v1 read API cannot fill
 * the gap — it exposes no diff, commits, contents or users. `baseRef`,
 * `headRef` and `draft` are therefore OMITTED, not defaulted: absent means
 * "open-git does not say", and the signals that read them skip honestly (§6).
 * A `""` ref or a `false` draft would be a fabrication in the audit trail.
 *
 * This is also why most of RULE_CATALOG declares `forges: ["github"]` — every
 * rule that reads a diff, a commit list or a contributor profile is inert here
 * until open-git ships those reads. The payload-only rules run for real.
 *
 * Installation events carry no actor and are not ingested here; repo grants
 * arrive through the install flow instead.
 */

const ogRepository = z.object({
	id: z.string(),
	name: z.string(),
	owner: z.string(),
});

const ogPullRequest = z.object({
	id: z.string().optional(),
	number: z.number(),
	title: z.string().default(""),
	head_sha: z.string().nullable().optional(),
	/**
	 * The opener's username, or null for an imported/system-authored PR. Added
	 * to every pull-request event by open-git; before it existed these events
	 * could not be ingested at all, because tripwire evaluates a contributor and
	 * there was nobody to name.
	 */
	author: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
});

const pullRequestPayload = z.object({
	installation_id: z.string().optional(),
	repository: ogRepository,
	pull_request: ogPullRequest,
});

const commentPayload = z.object({
	installation_id: z.string().optional(),
	repository: ogRepository,
	pull_request: ogPullRequest,
	comment: z.object({
		id: z.string(),
		author: z.string().nullable(),
		body: z.string(),
	}),
});

/** Deep links point at open-git.com unless a self-hosted origin is supplied.
 * The payload carries no URLs, so the adapter composes them. */
const OPEN_GIT_WEB_ORIGIN = (
	process.env.OPEN_GIT_URL ?? "https://open-git.com"
).replace(/\/$/, "");

/** open-git sends the action as the segment after the last dot. */
function actionOf(eventName: string): string {
	return eventName.slice(eventName.lastIndexOf(".") + 1);
}

const PR_ACTION_TO_KIND: Record<string, EventKind> = {
	opened: "change-request.opened",
	edited: "change-request.updated",
	synchronize: "change-request.updated",
	closed: "change-request.closed",
};

export function normalizeWebhook(
	event: RawForgeEvent,
	receivedAt: string,
): NormalizedEvent | null {
	const action = actionOf(event.eventName);
	if (!event.eventName.startsWith("pull_request.")) {
		// installation.* — no actor, and grants come through the install flow.
		return null;
	}

	const raw: unknown = JSON.parse(event.body);

	if (action !== "comment") {
		const kind = PR_ACTION_TO_KIND[action];
		if (!kind) {
			return null;
		}
		const pr = pullRequestPayload.parse(raw);
		// No author is open-git telling us this PR has no attributable user (an
		// import, or a system-authored change). Tripwire evaluates a contributor,
		// so there is nothing to evaluate — skip rather than invent one.
		if (!pr.pull_request.author) {
			return null;
		}
		// head_sha is what every downstream check is keyed on. open-git marks it
		// nullable, and a change request we cannot pin to a commit cannot be
		// gated, so it is not ingested.
		if (!pr.pull_request.head_sha) {
			return null;
		}
		const prFullName = `${pr.repository.owner}/${pr.repository.name}`;
		return normalizedEventSchema.parse({
			id: generateId(),
			forge: "opengit",
			deliveryId: event.deliveryId,
			kind,
			repo: {
				fullName: prFullName,
				owner: pr.repository.owner,
				name: pr.repository.name,
			},
			repoExternalId: pr.repository.id,
			// open-git puts the installation on every pull-request payload. This is
			// where tripwire learns it — its installation.created carries only repo
			// uuids, with no owner or name to build a row from.
			installationExternalId: pr.installation_id,
			actor: {
				login: pr.pull_request.author,
				// Username IS open-git's stable handle — see the comment path below.
				externalId: pr.pull_request.author,
			},
			// open-git puts no timestamp on the payload, so receipt is the honest
			// clock. It is monotonic per delivery and never in the future.
			occurredAt: receivedAt,
			receivedAt,
			changeRequest: {
				number: pr.pull_request.number,
				title: pr.pull_request.title,
				headSha: pr.pull_request.head_sha,
				url: `${OPEN_GIT_WEB_ORIGIN}/${prFullName}/pulls/${pr.pull_request.number}`,
			},
		} satisfies Record<string, unknown>);
	}

	const payload = commentPayload.parse(raw);
	const fullName = `${payload.repository.owner}/${payload.repository.name}`;
	// A null author is open-git telling us the comment has no attributable user
	// (a system note). Nothing to evaluate, so it is not ingested.
	if (!payload.comment.author) {
		return null;
	}

	return normalizedEventSchema.parse({
		id: generateId(),
		forge: "opengit",
		deliveryId: event.deliveryId,
		kind: "comment.created",
		repo: {
			fullName,
			owner: payload.repository.owner,
			name: payload.repository.name,
		},
		repoExternalId: payload.repository.id,
		actor: {
			login: payload.comment.author,
			// open-git identifies a commenter by username only; the username IS the
			// stable handle it exposes, so it doubles as the external id rather than
			// inventing a synthetic one.
			externalId: payload.comment.author,
		},
		occurredAt: receivedAt,
		receivedAt,
		comment: {
			externalId: payload.comment.id,
			body: payload.comment.body,
			url: `${OPEN_GIT_WEB_ORIGIN}/${fullName}/pulls/${payload.pull_request.number}`,
			subjectNumber: payload.pull_request.number,
			// §7 — our own comments carry the run marker; skip them so tripwire
			// does not moderate itself into a loop.
			byTripwire: payload.comment.body.includes(COMMENT_MARKER),
		},
	} satisfies Record<string, unknown>);
}
