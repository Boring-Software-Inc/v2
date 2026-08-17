import {
	COMMENT_MARKER,
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
 *   pull_request.synchronize -> change-request.updated
 *   pull_request.closed      -> change-request.closed
 *   pull_request.comment     -> comment.created
 *
 * ── THE ACTOR GAP ───────────────────────────────────────────────────────────
 * `NormalizedEvent` requires an `actor` — tripwire's whole model is "evaluate
 * the contributor" — and open-git's pull_request payload does not carry one.
 * Verified against the sender, not the docs: `emitPullRequestWebhooks` in
 * `lib/pull-requests/create-pull-request.ts` posts `{action, installation_id,
 * pull_request:{id,number,title,head_sha}, repository:{id,name,owner}}`. The
 * author is known at that call site (`actorProfileId` is passed to
 * `queuePullRequestWorkflows` on the line above) but is not included.
 *
 * So pull_request events return NULL rather than a fabricated actor. Inventing
 * one would poison contributor scoring, moderation and the audit trail with a
 * user who never existed — far worse than not ingesting. The delivery is still
 * stored raw at the route, so nothing is lost and the payloads become fixture
 * candidates (§11) for the day the field lands.
 *
 * Comment events DO carry `comment.author`, so those normalize for real.
 *
 * Installation events carry no actor either and are not ingested here; repo
 * grants arrive through the install flow instead.
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
const OPENGIT_WEB_ORIGIN = (
	process.env.OPENGIT_ORIGIN ?? "https://open-git.com"
).replace(/\/$/, "");

/** open-git sends the action as the segment after the last dot. */
function actionOf(eventName: string): string {
	return eventName.slice(eventName.lastIndexOf(".") + 1);
}

export function normalizeWebhook(
	event: RawForgeEvent,
	receivedAt: string,
): NormalizedEvent | null {
	const action = actionOf(event.eventName);
	if (!event.eventName.startsWith("pull_request.")) {
		// installation.* — no actor, and grants come through the install flow.
		return null;
	}
	if (action !== "comment") {
		// opened / synchronize / closed: no author in the payload. See THE ACTOR
		// GAP above — null, never a placeholder.
		return null;
	}

	const raw: unknown = JSON.parse(event.body);
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
			url: `${OPENGIT_WEB_ORIGIN}/${fullName}/pulls/${payload.pull_request.number}`,
			subjectNumber: payload.pull_request.number,
			// §7 — our own comments carry the run marker; skip them so tripwire
			// does not moderate itself into a loop.
			byTripwire: payload.comment.body.includes(COMMENT_MARKER),
		},
	} satisfies Record<string, unknown>);
}
