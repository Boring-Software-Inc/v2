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
 * Raw GitLab payload -> NormalizedEvent (§5.5/§5.6). The parsers pull exactly
 * what the neutral event needs. The result is validated against the contracts
 * schema before it leaves. Returns null for event kinds Tripwire does not
 * ingest. Throws on a malformed payload of an ingested kind. The worker
 * quarantines those.
 *
 * GitLab names differ from GitHub. This file maps them:
 *   - merge request  -> change-request
 *   - note           -> comment
 *   - `iid`          -> the change-request number
 *   - project path   -> repo full name
 * GitLab has no installation event. OAuth handles onboarding, so this adapter
 * emits no `installation.*` events.
 */

const glUser = z.object({
	id: z.number(),
	username: z.string(),
	avatar_url: z.string().nullable().optional(),
});

const glProject = z.object({
	id: z.number(),
	name: z.string(),
	path_with_namespace: z.string(),
});

const glMergeRequestAttributes = z.object({
	iid: z.number(),
	title: z.string(),
	source_branch: z.string(),
	target_branch: z.string(),
	url: z.string(),
	action: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	draft: z.boolean().optional(),
	work_in_progress: z.boolean().optional(),
	last_commit: z.object({ id: z.string() }),
});

const mergeRequestPayload = z.object({
	object_kind: z.literal("merge_request"),
	user: glUser,
	project: glProject,
	object_attributes: glMergeRequestAttributes,
});

const notePayload = z.object({
	object_kind: z.literal("note"),
	user: glUser,
	project: glProject,
	object_attributes: z.object({
		id: z.number(),
		note: z.string(),
		noteable_type: z.string(),
		url: z.string(),
		created_at: z.string(),
	}),
	merge_request: z.object({ iid: z.number() }).optional(),
});

const pushPayload = z.object({
	object_kind: z.literal("push"),
	user_id: z.number(),
	user_username: z.string(),
	user_avatar: z.string().nullable().optional(),
	project: glProject,
	ref: z.string(),
	after: z.string(),
	total_commits_count: z.number(),
	commits: z.array(z.object({ timestamp: z.string() })).default([]),
});

/** GitLab merge-request actions map to the neutral change-request kinds. */
const MR_ACTION_TO_KIND: Record<string, EventKind> = {
	open: "change-request.opened",
	reopen: "change-request.opened",
	update: "change-request.updated",
	close: "change-request.closed",
	merge: "change-request.closed",
};

function toUtcIso(value: string | undefined, fallback: string): string {
	if (!value) {
		return fallback;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/** Split `group/sub/project` into owner (`group/sub`) and name (`project`). */
function splitPath(pathWithNamespace: string): { owner: string; name: string } {
	const parts = pathWithNamespace.split("/");
	const name = parts.pop() ?? pathWithNamespace;
	return { owner: parts.join("/") || pathWithNamespace, name };
}

function base(
	project: z.infer<typeof glProject>,
	user: { id: number; username: string; avatar_url?: string | null },
	raw: Pick<RawForgeEvent, "deliveryId">,
	receivedAt: string,
) {
	const { owner, name } = splitPath(project.path_with_namespace);
	return {
		id: generateId(),
		forge: "gitlab" as const,
		deliveryId: raw.deliveryId,
		repo: { owner, name, fullName: project.path_with_namespace },
		repoExternalId: String(project.id),
		actor: {
			login: user.username,
			externalId: String(user.id),
			avatarUrl: user.avatar_url ?? undefined,
		},
		receivedAt,
	};
}

export function normalizeWebhook(
	event: RawForgeEvent,
	receivedAt: string,
): NormalizedEvent | null {
	const payload: unknown = JSON.parse(event.body);

	if (event.eventName === "Merge Request Hook") {
		const p = mergeRequestPayload.parse(payload);
		const kind = MR_ACTION_TO_KIND[p.object_attributes.action];
		if (!kind) {
			return null;
		}
		const attrs = p.object_attributes;
		const occurred =
			attrs.action === "open" ? attrs.created_at : attrs.updated_at;
		return normalizedEventSchema.parse({
			...base(p.project, p.user, event, receivedAt),
			kind,
			occurredAt: toUtcIso(occurred, receivedAt),
			changeRequest: {
				number: attrs.iid,
				title: attrs.title,
				headSha: attrs.last_commit.id,
				baseRef: attrs.target_branch,
				headRef: attrs.source_branch,
				draft: attrs.draft ?? attrs.work_in_progress ?? false,
				url: attrs.url,
			},
		});
	}

	if (event.eventName === "Note Hook") {
		const p = notePayload.parse(payload);
		// Ingest merge-request notes only. Ignore notes on issues, commits, snippets.
		if (
			p.object_attributes.noteable_type !== "MergeRequest" ||
			!p.merge_request
		) {
			return null;
		}
		return normalizedEventSchema.parse({
			...base(p.project, p.user, event, receivedAt),
			kind: "comment.created",
			occurredAt: toUtcIso(p.object_attributes.created_at, receivedAt),
			comment: {
				externalId: String(p.object_attributes.id),
				body: p.object_attributes.note,
				url: p.object_attributes.url,
				subjectNumber: p.merge_request.iid,
				byTripwire: p.object_attributes.note.includes(COMMENT_MARKER),
			},
		});
	}

	if (event.eventName === "Push Hook") {
		const p = pushPayload.parse(payload);
		return normalizedEventSchema.parse({
			...base(
				p.project,
				{ id: p.user_id, username: p.user_username, avatar_url: p.user_avatar },
				event,
				receivedAt,
			),
			kind: "push",
			occurredAt: toUtcIso(p.commits[0]?.timestamp, receivedAt),
			push: {
				ref: p.ref,
				headSha: p.after,
				commitCount: p.total_commits_count,
			},
		});
	}

	return null;
}
