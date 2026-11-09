import {
	type GitCafeCommentEvent,
	type GitCafeCommentIdentity,
	type GitCafeHydratedCommentEvent,
	type GitCafeHydratedPullEvent,
	type GitCafeHydratedPushRef,
	type GitCafeInstallation,
	type GitCafePullEvent,
	type GitCafePushEvent,
	gitCafeCommentDetailSchema,
	gitCafeCommentEventSchema,
	gitCafeCommentSubjectSchema,
	gitCafeCompletePushEventSchema,
	gitCafeHydratedCommentEventSchema,
	gitCafeHydratedPullEventSchema,
	gitCafeHydratedPushRefSchema,
	gitCafeIssueCommentPageSchema,
	gitCafePullEventSchema,
	gitCafePullIdentitySchema,
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import type {
	GitCafeInstallationClient,
	GitCafeInstallationFailure,
} from "./installation-client.ts";
import { type GitCafeReadFailure, GitCafeReads } from "./reads.ts";

/** Each signed ref update remains independent; a later head or missing actor cannot become current push evidence. */
export async function hydrateGitCafePushRef(
	client: GitCafeInstallationClient,
	expectedInstallation: GitCafeInstallation,
	input: GitCafePushEvent,
	ref: string,
): Promise<
	| { ok: true; value: GitCafeHydratedPushRef }
	| GitCafeReadFailure
	| { ok: false; reason: "stale-event" }
> {
	const parsed = gitCafeCompletePushEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid-response" };
	const event = parsed.data;
	const update = event.git.refUpdates.find((item) => item.ref === ref);
	if (
		!update ||
		update.deleted !== (update.afterOid === null) ||
		update.created !== (update.beforeOid === null) ||
		(update.created && update.deleted)
	)
		return { ok: false, reason: "invalid-response" };
	if (
		event.installation.id !== expectedInstallation.id ||
		event.repository.owner !== expectedInstallation.org
	)
		return { ok: false, reason: "identity-mismatch" };
	if (!event.actor?.id) return { ok: false, reason: "author-unavailable" };
	const generation = client.generation(expectedInstallation.id);
	const reads = new GitCafeReads({
		client,
		installationId: expectedInstallation.id,
		expectedInstallation,
	});
	const repo = `${event.repository.owner}/${event.repository.name}`;
	const author = await reads.getActor(
		repo,
		event.repository.id,
		event.actor.id,
	);
	if (!author.ok) return author;
	const current = await reads.getRef(repo, event.repository.id, ref);
	if (!current.ok) return current;
	if (client.generation(expectedInstallation.id) !== generation)
		return { ok: false, reason: "stale" };
	if ((current.value?.oid ?? null) !== update.afterOid)
		return { ok: false, reason: "stale-event" };
	return {
		ok: true,
		value: gitCafeHydratedPushRefSchema.parse({
			event,
			ref,
			author: author.value,
			sender: author.value,
		}),
	};
}

export function normalizeGitCafePushRef(
	input: GitCafeHydratedPushRef,
	receivedAt: string,
): NormalizedEvent | null {
	const parsed = gitCafeHydratedPushRefSchema.safeParse(input);
	if (!parsed.success) return null;
	const { event, ref, author, sender } = parsed.data;
	const update = event.git.refUpdates.find((item) => item.ref === ref);
	if (!update) return null;
	return normalizedEventSchema.parse({
		id: generateId(),
		forge: "gitcafe",
		deliveryId: JSON.stringify([event.installation.id, event.id, ref]),
		repo: {
			owner: event.repository.owner,
			name: event.repository.name,
			fullName: `${event.repository.owner}/${event.repository.name}`,
		},
		repoExternalId: event.repository.id,
		installationExternalId: event.installation.id,
		actor: author,
		sender,
		occurredAt: event.createdAt,
		receivedAt,
		kind: "push",
		push: { ref, headSha: update.afterOid, commitCount: null },
	});
}

export type GitCafePullHydrationResult =
	| { ok: true; value: GitCafeHydratedPullEvent }
	| GitCafeInstallationFailure
	| { ok: false; reason: "stale-event" | "author-unavailable" };

export type GitCafeCommentHydrationResult =
	| { ok: true; value: GitCafeHydratedCommentEvent }
	| GitCafeInstallationFailure
	| {
			ok: false;
			reason: "stale-event" | "author-unavailable" | "comment-unavailable";
	  };

/** Comment evidence belongs to its live author, independently of the PR author or event sender. */
export async function hydrateGitCafeCommentEvent(
	client: GitCafeInstallationClient,
	expectedInstallation: GitCafeInstallation,
	input: GitCafeCommentEvent,
	deadlineAt?: number,
): Promise<GitCafeCommentHydrationResult> {
	const parsed = gitCafeCommentEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid-response" };
	const event = parsed.data;
	if (
		event.installation.id !== expectedInstallation.id ||
		event.repository.owner !== expectedInstallation.org
	)
		return { ok: false, reason: "identity-mismatch" };
	if (
		event.comment.body === null ||
		(event.type === "pull.comment_created" &&
			(event.comment.hidden ||
				event.comment.deleted ||
				event.comment.bodyTruncated))
	)
		return { ok: false, reason: "stale-event" };
	const repository = await client.getRepository(
		expectedInstallation.id,
		event.repository.owner,
		event.repository.name,
		expectedInstallation,
		deadlineAt,
	);
	if (!repository.ok) return repository;
	if (
		repository.value.id !== event.repository.id ||
		repository.value.owner !== event.repository.owner ||
		repository.value.name !== event.repository.name ||
		repository.value.archivedAt !== null
	)
		return { ok: false, reason: "identity-mismatch" };
	const subject =
		event.type === "pull.comment_created" ? event.pull : event.issue;
	const kind = event.type === "pull.comment_created" ? "pulls" : "issues";
	const root = `repos/${event.repository.owner}/${event.repository.name}/${kind}/${subject.number}`;
	const response = await client.request(
		expectedInstallation.id,
		{ method: "GET", resourcePath: root },
		expectedInstallation,
		deadlineAt,
	);
	if (!response.ok) return response;
	const current = gitCafeCommentSubjectSchema.safeParse(response.value);
	if (!current.success) return { ok: false, reason: "invalid-response" };
	if (
		current.data.id !== subject.id ||
		current.data.number !== subject.number ||
		current.data.repoId !== event.repository.id
	)
		return { ok: false, reason: "identity-mismatch" };
	let detail: GitCafeCommentIdentity | null = null;
	if (event.type === "pull.comment_created") {
		const read = await client.request(
			expectedInstallation.id,
			{
				method: "GET",
				resourcePath: `${root}/comments/${encodeURIComponent(event.comment.id)}/detail`,
			},
			expectedInstallation,
			deadlineAt,
		);
		if (!read.ok) return read;
		const comment = gitCafeCommentDetailSchema.safeParse(read.value);
		if (!comment.success) return { ok: false, reason: "invalid-response" };
		if (comment.data.hiddenAt !== null || comment.data.deletedAt !== null)
			return { ok: false, reason: "stale-event" };
		detail = comment.data;
	} else {
		const cursors = new Set<string>();
		const ids = new Set<string>();
		let after: string | null = null;
		do {
			const query = new URLSearchParams({ limit: "100" });
			if (after !== null) query.set("after", after);
			const read = await client.request(
				expectedInstallation.id,
				{ method: "GET", resourcePath: `${root}/comments/?${query}` },
				expectedInstallation,
				deadlineAt,
			);
			if (!read.ok) return read;
			const page = gitCafeIssueCommentPageSchema.safeParse(read.value);
			if (!page.success) return { ok: false, reason: "invalid-response" };
			for (const comment of page.data.items) {
				if (
					ids.has(comment.id) ||
					comment.repoId !== event.repository.id ||
					comment.issueId !== event.issue.id
				)
					return { ok: false, reason: "identity-mismatch" };
				ids.add(comment.id);
				if (comment.id === event.comment.id) detail = comment;
			}
			after = page.data.next;
			if (after !== null && cursors.has(after))
				return { ok: false, reason: "invalid-response" };
			if (after !== null) cursors.add(after);
		} while (after !== null);
	}
	if (!detail) return { ok: false, reason: "comment-unavailable" };
	if (
		detail.id !== event.comment.id ||
		detail.authorActorId !== event.comment.authorActorId ||
		detail.author.actorId !== detail.authorActorId
	)
		return { ok: false, reason: "identity-mismatch" };
	if (
		detail.version !== event.comment.version ||
		detail.body !== event.comment.body
	)
		return { ok: false, reason: "stale-event" };
	if (!detail.authorActorId || !detail.author.handle)
		return { ok: false, reason: "author-unavailable" };
	const finalResponse = await client.request(
		expectedInstallation.id,
		{ method: "GET", resourcePath: root },
		expectedInstallation,
		deadlineAt,
	);
	if (!finalResponse.ok) return finalResponse;
	const final = gitCafeCommentSubjectSchema.safeParse(finalResponse.value);
	if (!final.success) return { ok: false, reason: "invalid-response" };
	if (
		final.data.id !== current.data.id ||
		final.data.number !== current.data.number ||
		final.data.repoId !== current.data.repoId
	)
		return { ok: false, reason: "identity-mismatch" };
	if (
		event.type === "pull.comment_created" &&
		final.data.headOid !== current.data.headOid
	)
		/** The unchanged comment can acquire a stable head on retry before its run commits. */
		return { ok: false, reason: "stale" };
	const author = {
		login: detail.author.handle,
		externalId: detail.authorActorId,
		avatarUrl: detail.author.avatarUrl ?? undefined,
	};
	const sender =
		event.actor?.id === expectedInstallation.bot.actorId
			? {
					login: expectedInstallation.bot.handle,
					externalId: expectedInstallation.bot.actorId,
				}
			: event.actor?.id === author.externalId
				? author
				: undefined;
	return {
		ok: true,
		value: gitCafeHydratedCommentEventSchema.parse({
			event,
			author,
			sender,
			botActorId: expectedInstallation.bot.actorId,
			headOid:
				event.type === "pull.comment_created"
					? (current.data.headOid ?? null)
					: null,
		}),
	};
}

/** The verified comment author is the contributor; subject kind keeps issue and PR actions separate. */
export function normalizeGitCafeCommentEvent(
	input: GitCafeHydratedCommentEvent,
	receivedAt: string,
): NormalizedEvent | null {
	const hydrated = gitCafeHydratedCommentEventSchema.parse(input);
	const { event, author, sender } = hydrated;
	if (event.comment.body === null) return null;
	const subject =
		event.type === "pull.comment_created" ? event.pull : event.issue;
	const subjectKind =
		event.type === "pull.comment_created" ? "change-request" : "issue";
	const fullName = `${event.repository.owner}/${event.repository.name}`;
	return normalizedEventSchema.parse({
		id: generateId(),
		forge: "gitcafe",
		deliveryId: JSON.stringify([event.installation.id, event.id]),
		kind: "comment.created",
		repo: {
			owner: event.repository.owner,
			name: event.repository.name,
			fullName,
		},
		repoExternalId: event.repository.id,
		installationExternalId: event.installation.id,
		actor: author,
		sender,
		occurredAt: event.createdAt,
		receivedAt,
		comment: {
			externalId: event.comment.id,
			body: event.comment.body,
			subjectNumber: subject.number,
			subjectKind,
			subjectHeadSha:
				subjectKind === "change-request"
					? (hydrated.headOid ?? undefined)
					: undefined,
			url: `https://git.cafe/${fullName}/${subjectKind === "issue" ? "issues" : "pull"}/${subject.number}`,
			byTripwire: author.externalId === hydrated.botActorId,
		},
	});
}

/** The event sender is not the contributor; the installed PR read binds the author to its stable actor ID. */
export async function hydrateGitCafePullEvent(
	client: GitCafeInstallationClient,
	expectedInstallation: GitCafeInstallation,
	input: GitCafePullEvent,
	deadlineAt?: number,
): Promise<GitCafePullHydrationResult> {
	const parsed = gitCafePullEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid-response" };
	const event = parsed.data;
	const installationId = event.installation.id;
	if (
		installationId !== expectedInstallation.id ||
		event.repository.owner !== expectedInstallation.org
	)
		return { ok: false, reason: "identity-mismatch" };
	const repository = await client.getRepository(
		installationId,
		event.repository.owner,
		event.repository.name,
		expectedInstallation,
		deadlineAt,
	);
	if (!repository.ok) return repository;
	if (
		repository.value.id !== event.repository.id ||
		repository.value.owner !== event.repository.owner ||
		repository.value.name !== event.repository.name ||
		repository.value.archivedAt !== null
	)
		return { ok: false, reason: "identity-mismatch" };
	const response = await client.request(
		installationId,
		{
			method: "GET",
			resourcePath: `repos/${event.repository.owner}/${event.repository.name}/pulls/${event.pull.number}`,
		},
		expectedInstallation,
		deadlineAt,
	);
	if (!response.ok) return response;
	const current = gitCafePullIdentitySchema.safeParse(response.value);
	if (!current.success) return { ok: false, reason: "invalid-response" };
	const pull = current.data;
	if (
		pull.id !== event.pull.id ||
		pull.number !== event.pull.number ||
		pull.repoId !== event.repository.id ||
		pull.authorActorId !== event.pull.authorActorId
	)
		return { ok: false, reason: "identity-mismatch" };
	if (
		pull.version !== event.pull.version ||
		pull.headOid !== event.pull.headOid ||
		pull.state !== event.pull.state ||
		pull.draft !== event.pull.draft ||
		pull.title !== event.pull.title ||
		pull.sourceBranch !== event.pull.sourceBranch ||
		pull.targetBranch !== event.pull.targetBranch ||
		pull.headOid === null
	)
		return { ok: false, reason: "stale-event" };
	if (
		!pull.authorActorId ||
		pull.author.actorId !== pull.authorActorId ||
		!pull.author.handle
	)
		return { ok: false, reason: "author-unavailable" };
	const author = {
		login: pull.author.handle,
		externalId: pull.authorActorId,
		avatarUrl: pull.author.avatarUrl ?? undefined,
	};
	const sender =
		event.actor?.id === expectedInstallation.bot.actorId
			? {
					login: expectedInstallation.bot.handle,
					externalId: expectedInstallation.bot.actorId,
				}
			: event.actor?.id === author.externalId
				? author
				: undefined;
	return {
		ok: true,
		value: gitCafeHydratedPullEventSchema.parse({ event, author, sender }),
	};
}

/** Pure projection after hydration; no provider fields are written into the raw receipt. */
export function normalizeGitCafePullEvent(
	input: GitCafeHydratedPullEvent,
	receivedAt: string,
): NormalizedEvent | null {
	const hydrated = gitCafeHydratedPullEventSchema.parse(input);
	const { event, author, sender } = hydrated;
	if (event.pull.headOid === null) return null;
	const kind =
		event.type === "pull.created" || event.type === "pull.reopened"
			? "change-request.opened"
			: event.type === "pull.closed" || event.type === "pull.merged"
				? "change-request.closed"
				: "change-request.updated";
	const fullName = `${event.repository.owner}/${event.repository.name}`;
	return normalizedEventSchema.parse({
		id: generateId(),
		forge: "gitcafe",
		deliveryId: JSON.stringify([event.installation.id, event.id]),
		kind,
		repo: {
			owner: event.repository.owner,
			name: event.repository.name,
			fullName,
		},
		repoExternalId: event.repository.id,
		installationExternalId: event.installation.id,
		actor: author,
		sender,
		occurredAt: event.createdAt,
		receivedAt,
		changeRequest: {
			number: event.pull.number,
			title: event.pull.title,
			headSha: event.pull.headOid,
			baseRef: event.pull.targetBranch,
			headRef: event.pull.sourceBranch,
			draft: event.pull.draft,
			url: `https://git.cafe/${fullName}/pulls/${event.pull.number}`,
		},
	});
}
