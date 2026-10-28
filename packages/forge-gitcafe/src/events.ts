import {
	type GitCafeHydratedPullEvent,
	type GitCafeInstallation,
	type GitCafePullEvent,
	gitCafeHydratedPullEventSchema,
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

export type GitCafePullHydrationResult =
	| { ok: true; value: GitCafeHydratedPullEvent }
	| GitCafeInstallationFailure
	| { ok: false; reason: "stale-event" | "author-unavailable" };

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
