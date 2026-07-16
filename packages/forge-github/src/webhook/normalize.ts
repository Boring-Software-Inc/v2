import {
	type EventKind,
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import type { RawForgeEvent } from "@tripwire/forge";
import { generateId } from "@tripwire/utils";
import { z } from "zod";
import { COMMENT_MARKER } from "../actions/comment.ts";

/**
 * Raw GitHub payload → NormalizedEvent (§5.5/§5.6). Domain-internal Zod
 * parsers pull exactly what the neutral event needs; the result is validated
 * against the contracts schema before it leaves. Returns null for event kinds
 * Tripwire does not ingest; throws on malformed payloads of ingested kinds —
 * the worker quarantines those.
 */

const ghAccount = z.object({
	login: z.string(),
	id: z.number(),
	avatar_url: z.string().optional(),
});

const ghRepository = z.object({
	id: z.number(),
	name: z.string(),
	full_name: z.string(),
	owner: z.object({ login: z.string() }),
});

const ghPullRequest = z.object({
	number: z.number(),
	title: z.string(),
	draft: z.boolean().default(false),
	html_url: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	head: z.object({ sha: z.string(), ref: z.string() }),
	base: z.object({ ref: z.string() }),
});

const pullRequestPayload = z.object({
	action: z.string(),
	pull_request: ghPullRequest,
	repository: ghRepository,
	sender: ghAccount,
});

const issueCommentPayload = z.object({
	action: z.string(),
	issue: z.object({ number: z.number() }),
	comment: z.object({
		id: z.number(),
		body: z.string(),
		html_url: z.string(),
		created_at: z.string(),
	}),
	repository: ghRepository,
	sender: ghAccount,
});

const ghInstallationRepo = z.object({
	id: z.number(),
	name: z.string(),
	full_name: z.string(),
	private: z.boolean().default(false),
});

/** GitHub's installable account types; anything else is omitted, not guessed. */
function toAccountType(
	t: string | undefined,
): "User" | "Organization" | undefined {
	return t === "User" || t === "Organization" ? t : undefined;
}

const installationPayload = z.object({
	action: z.string(),
	installation: z.object({
		id: z.number(),
		account: z.object({ login: z.string(), type: z.string().optional() }),
	}),
	repositories: z.array(ghInstallationRepo).optional(),
	sender: ghAccount,
});

const installationRepositoriesPayload = z.object({
	action: z.string(),
	installation: z.object({
		id: z.number(),
		account: z.object({ login: z.string(), type: z.string().optional() }),
	}),
	repositories_added: z.array(ghInstallationRepo).default([]),
	repositories_removed: z.array(ghInstallationRepo).default([]),
	sender: ghAccount,
});

const pushPayload = z.object({
	ref: z.string(),
	after: z.string(),
	compare: z.string().optional(),
	commits: z.array(z.unknown()),
	head_commit: z.object({ timestamp: z.string() }).nullable(),
	repository: ghRepository,
	sender: ghAccount,
});

const PR_ACTION_TO_KIND: Record<string, EventKind> = {
	opened: "change-request.opened",
	reopened: "change-request.opened",
	ready_for_review: "change-request.opened",
	synchronize: "change-request.updated",
	closed: "change-request.closed",
};

function toUtcIso(value: string | undefined, fallback: string): string {
	if (!value) {
		return fallback;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function base(
	repo: z.infer<typeof ghRepository>,
	sender: z.infer<typeof ghAccount>,
	raw: Pick<RawForgeEvent, "deliveryId">,
	receivedAt: string,
) {
	return {
		id: generateId(),
		forge: "github" as const,
		deliveryId: raw.deliveryId,
		repo: {
			owner: repo.owner.login,
			name: repo.name,
			fullName: repo.full_name,
		},
		repoExternalId: String(repo.id),
		actor: {
			login: sender.login,
			externalId: String(sender.id),
			avatarUrl: sender.avatar_url,
		},
		receivedAt,
	};
}

export function normalizeWebhook(
	event: RawForgeEvent,
	receivedAt: string,
): NormalizedEvent | null {
	const payload: unknown = JSON.parse(event.body);

	if (event.eventName === "pull_request") {
		const p = pullRequestPayload.parse(payload);
		const kind = PR_ACTION_TO_KIND[p.action];
		if (!kind) {
			return null;
		}
		const occurred =
			p.action === "opened"
				? p.pull_request.created_at
				: p.pull_request.updated_at;
		return normalizedEventSchema.parse({
			...base(p.repository, p.sender, event, receivedAt),
			kind,
			occurredAt: toUtcIso(occurred, receivedAt),
			changeRequest: {
				number: p.pull_request.number,
				title: p.pull_request.title,
				headSha: p.pull_request.head.sha,
				baseRef: p.pull_request.base.ref,
				headRef: p.pull_request.head.ref,
				draft: p.pull_request.draft,
				url: p.pull_request.html_url,
			},
		});
	}

	if (event.eventName === "issue_comment") {
		const p = issueCommentPayload.parse(payload);
		if (p.action !== "created") {
			return null;
		}
		return normalizedEventSchema.parse({
			...base(p.repository, p.sender, event, receivedAt),
			kind: "comment.created",
			occurredAt: toUtcIso(p.comment.created_at, receivedAt),
			comment: {
				externalId: String(p.comment.id),
				body: p.comment.body,
				url: p.comment.html_url,
				subjectNumber: p.issue.number,
				byTripwire: p.comment.body.includes(COMMENT_MARKER),
			},
		});
	}

	if (event.eventName === "installation") {
		const p = installationPayload.parse(payload);
		if (p.action !== "created" && p.action !== "deleted") {
			return null;
		}
		return normalizedEventSchema.parse({
			id: generateId(),
			forge: "github" as const,
			deliveryId: event.deliveryId,
			actor: {
				login: p.sender.login,
				externalId: String(p.sender.id),
				avatarUrl: p.sender.avatar_url,
			},
			occurredAt: receivedAt,
			receivedAt,
			kind: `installation.${p.action}` as const,
			installation: {
				externalId: String(p.installation.id),
				account: p.installation.account.login,
				accountType: toAccountType(p.installation.account.type),
			},
			repositories: (p.repositories ?? []).map(toInstallationRepo),
		});
	}

	if (event.eventName === "installation_repositories") {
		const p = installationRepositoriesPayload.parse(payload);
		if (p.action !== "added" && p.action !== "removed") {
			return null;
		}
		const repositories =
			p.action === "added" ? p.repositories_added : p.repositories_removed;
		return normalizedEventSchema.parse({
			id: generateId(),
			forge: "github" as const,
			deliveryId: event.deliveryId,
			actor: {
				login: p.sender.login,
				externalId: String(p.sender.id),
				avatarUrl: p.sender.avatar_url,
			},
			occurredAt: receivedAt,
			receivedAt,
			kind: `installation-repositories.${p.action}` as const,
			installation: {
				externalId: String(p.installation.id),
				account: p.installation.account.login,
				accountType: toAccountType(p.installation.account.type),
			},
			repositories: repositories.map(toInstallationRepo),
		});
	}

	if (event.eventName === "push") {
		const p = pushPayload.parse(payload);
		return normalizedEventSchema.parse({
			...base(p.repository, p.sender, event, receivedAt),
			kind: "push",
			occurredAt: toUtcIso(p.head_commit?.timestamp, receivedAt),
			push: {
				ref: p.ref,
				headSha: p.after,
				commitCount: p.commits.length,
				url: p.compare,
			},
		});
	}

	return null;
}

function toInstallationRepo(repo: z.infer<typeof ghInstallationRepo>) {
	const [owner, name] = repo.full_name.split("/");
	return {
		externalId: String(repo.id),
		owner: owner ?? repo.full_name,
		name: name ?? repo.name,
		fullName: repo.full_name,
		private: repo.private,
	};
}
