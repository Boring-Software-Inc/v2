import { isDeepStrictEqual } from "node:util";
import {
	type GitCafeReadBoundary,
	type GitCafeRepositoryBinding,
	gitCafeCheckRerequestedEventSchema,
	gitCafeDispatchableRepositoryEventSchema,
	gitCafeHydratedCommentEventSchema,
	gitCafeHydratedPullEventSchema,
	gitCafePullIdentitySchema,
	normalizedEventSchema,
	REVIEW_POINTER,
	type RepoLabel,
	type RerunChangeRequestJob,
	scheduledEventSchema,
	scheduledThreadSchema,
} from "@tripwire/contracts";
import {
	type Db,
	eventServices,
	gitCafeActionServices,
	gitCafeLifecycleServices,
	organizationInstallations,
	repoServices,
	repos,
	runServices,
} from "@tripwire/db";
import type {
	ForgeAction,
	ForgeActionContext,
	ForgeReadResult,
	RawForgeEvent,
} from "@tripwire/forge";
import {
	GitCafeActions,
	type GitCafeAppCredentials,
	GitCafeInstallationClient,
	type GitCafeInstallationClientOptions,
	GitCafeReads,
	hydrateGitCafeCommentEvent,
	hydrateGitCafePullEvent,
	normalizeGitCafeCommentEvent,
	normalizeGitCafePullEvent,
	verifyGitCafeCheckRerequest,
	verifyGitCafeWebhook,
} from "@tripwire/forge-gitcafe";
import { PENDING_CHECK_SUMMARY } from "@tripwire/forge-github";
import { and, eq, isNull } from "drizzle-orm";
import type { Pool } from "pg";
import type { ForgeRuntime } from "./forge-runtime.ts";
import { toForgeAction } from "./jobs/pr-surface.ts";

export interface GitCafeRuntime extends ForgeRuntime {
	getCatalogs(repoId: string): Promise<
		ForgeReadResult<{
			binding: GitCafeRepositoryBinding;
			branches: ForgeReadResult<string[]>;
			labels: ForgeReadResult<RepoLabel[]>;
		}>
	>;
	prepareCheckRerequest(
		eventId: string,
	): Promise<ForgeReadResult<RerunChangeRequestJob>>;
}

export function buildGitCafeRuntime(
	db: Db,
	credentials: GitCafeAppCredentials,
	fetch?: GitCafeInstallationClientOptions["fetch"],
	actionPool: Pool = db.$client,
): GitCafeRuntime {
	const bind = async (repoFullName: string, context?: ForgeActionContext) => {
		const [row] = await db
			.select()
			.from(repos)
			.innerJoin(
				organizationInstallations,
				and(
					eq(organizationInstallations.forge, repos.forge),
					eq(organizationInstallations.installationId, repos.installationId),
					eq(organizationInstallations.organizationId, repos.orgId),
				),
			)
			.where(
				and(
					eq(repos.forge, "gitcafe"),
					eq(repos.fullName, repoFullName),
					isNull(repos.removedAt),
				),
			);
		if (!row?.repos.installationId)
			return { ok: false as const, reason: "inactive" as const };
		const installationId = row.repos.installationId;
		const authority = await gitCafeLifecycleServices.getGitCafeActionAuthority(
			db,
			installationId,
		);
		if (!authority.allowed)
			return { ok: false as const, reason: "inactive" as const };
		const binding: GitCafeRepositoryBinding = {
			repoId: row.repos.id,
			organizationId: row.organization_installations.organizationId,
			installationId,
			repositoryId: row.repos.externalId,
			fullName: row.repos.fullName,
			generation: authority.generation,
		};
		const client = new GitCafeInstallationClient({
			credentials,
			fetch,
			lifecycleGuard: async (id) => {
				if (
					!(await gitCafeLifecycleServices.matchesGitCafeRepositoryBinding(
						db,
						binding,
					))
				)
					return false;
				if (
					context &&
					!("actionId" in context
						? await gitCafeActionServices.getGitCafeActionBinding(
								db,
								context.actionId,
							)
						: await gitCafeActionServices.getGitCafePendingCheckBinding(
								db,
								context.eventId,
							))
				)
					return false;
				return (
					await gitCafeLifecycleServices.getGitCafeActionAuthority(
						db,
						id,
						authority.generation,
					)
				).allowed;
			},
		});
		const installation = await client.getInstallation(installationId);
		if (!installation.ok) return installation;
		if (
			installation.value.appId !== credentials.appId ||
			installation.value.org !== row.repos.owner
		)
			return { ok: false as const, reason: "identity-mismatch" as const };
		if (
			(authority.providerVersion !== null &&
				installation.value.version < authority.providerVersion) ||
			(authority.providerRevision !== null &&
				installation.value.revision < authority.providerRevision)
		)
			return { ok: false as const, reason: "stale" as const };
		const repository = await client.getRepository(
			installationId,
			row.repos.owner,
			row.repos.name,
			installation.value,
		);
		if (!repository.ok) return repository;
		if (
			repository.value.id !== row.repos.externalId ||
			repository.value.archivedAt !== null
		)
			return { ok: false as const, reason: "identity-mismatch" as const };
		return {
			ok: true as const,
			client,
			binding,
			generation: authority.generation,
			installation: installation.value,
			repositoryId: row.repos.externalId,
			reads: new GitCafeReads({
				client,
				installationId,
				expectedInstallation: installation.value,
			}),
		};
	};
	const reads = {
		async getDiff(
			repo: string,
			number: number,
			head?: Parameters<GitCafeReads["getDiff"]>[2],
		) {
			const bound = await bind(repo);
			return bound.ok ? bound.reads.getDiff(repo, number, head) : bound;
		},
		async getCommits(
			repo: string,
			number: number,
			head?: Parameters<GitCafeReads["getCommits"]>[2],
		) {
			const bound = await bind(repo);
			return bound.ok ? bound.reads.getCommits(repo, number, head) : bound;
		},
		async getContributorProfile(repo: string, login: string, actorId?: string) {
			const bound = await bind(repo);
			return bound.ok
				? bound.reads.getContributorProfile(repo, login, actorId)
				: bound;
		},
	};
	const readFile = async (repo: string, path: string, oid: string) => {
		const bound = await bind(repo);
		return bound.ok ? bound.reads.readFile(repo, path, oid) : bound;
	};
	const executeBound = async (
		action: ForgeAction,
		context?: ForgeActionContext,
	) => {
		const binding =
			context &&
			("actionId" in context
				? await gitCafeActionServices.getGitCafeActionBinding(
						db,
						context.actionId,
					)
				: action.kind === "set-check"
					? await gitCafeActionServices.getGitCafePendingCheckBinding(
							db,
							context.eventId,
						)
					: null);
		if (!binding) return { refused: true as const, reason: "inactive" };
		if (context && "actionId" in context) {
			const row = await gitCafeActionServices.getGitCafeRecordedAction(
				db,
				context.actionId,
			);
			if (!row) return { refused: true as const, reason: "inactive" };
			const review = await runServices.getActiveBlockReviewId(
				db,
				{ forge: "gitcafe", fullName: binding.repoFullName },
				binding.number,
			);
			const expected = toForgeAction(
				row,
				binding.repoFullName,
				binding.number,
				row.payload.reason ?? REVIEW_POINTER.block,
				review,
			);
			if (!isDeepStrictEqual(action, expected))
				return { refused: true as const, reason: "command-mismatch" };
		} else if (
			action.kind !== "set-check" ||
			action.check.conclusion !== "pending" ||
			action.check.summary !== PENDING_CHECK_SUMMARY ||
			action.check.detailsUrl !== "https://staging.tripwire.sh"
		)
			return { refused: true as const, reason: "command-mismatch" };
		const bound = await bind(action.repoFullName, context);
		if (!bound.ok)
			return {
				refused: true as const,
				reason: bound.reason,
				status: "status" in bound ? bound.status : undefined,
			};
		const actions = new GitCafeActions({
			client: bound.client,
			installation: bound.installation,
			store: {
				read: (id) => gitCafeActionServices.readGitCafeAction(db, id),
				prepare: (operation) =>
					gitCafeActionServices.prepareGitCafeAction(db, operation),
				claimComment: (id) => gitCafeActionServices.claimGitCafeComment(db, id),
				dispatchReview: (id) =>
					gitCafeActionServices.dispatchGitCafeReview(db, id),
				releaseReview: (id) =>
					gitCafeActionServices.releaseGitCafeReview(db, id),
				recordReviewReceipt: (id, reviewId) =>
					gitCafeActionServices.recordGitCafeReviewReceipt(db, id, reviewId),
				pendingReviews: (id) =>
					gitCafeActionServices.getPendingGitCafeReviewSubmissions(db, id),
				releaseComment: (id) =>
					gitCafeActionServices.releaseGitCafeComment(db, id),
			},
		});
		const result = await actions.execute(action, binding);
		return result.ok
			? result.value
			: {
					refused: true as const,
					reason: result.reason,
					status: "status" in result ? result.status : undefined,
				};
	};
	const execute = async (action: ForgeAction, context?: ForgeActionContext) => {
		const binding =
			context &&
			("actionId" in context
				? await gitCafeActionServices.getGitCafeActionBinding(
						db,
						context.actionId,
					)
				: await gitCafeActionServices.getGitCafePendingCheckBinding(
						db,
						context.eventId,
					));
		if (!binding) return { refused: true as const, reason: "inactive" };
		const lock = await actionPool.connect();
		const key = JSON.stringify([
			binding.installationId,
			binding.repositoryId,
			binding.subject,
			binding.number,
		]);
		try {
			await lock.query(
				"SELECT pg_advisory_lock(hashtext('gitcafe-subject'),hashtext($1))",
				[key],
			);
			return await executeBound(action, context);
		} finally {
			try {
				await lock.query(
					"SELECT pg_advisory_unlock(hashtext('gitcafe-subject'),hashtext($1))",
					[key],
				);
			} finally {
				lock.release();
			}
		}
	};
	const normalize = (raw: RawForgeEvent, receivedAt: string) => {
		const parsed = parseJson(raw.body, gitCafeHydratedPullEventSchema);
		if (parsed) return normalizeGitCafePullEvent(parsed, receivedAt);
		const comment = parseJson(raw.body, gitCafeHydratedCommentEventSchema);
		return comment ? normalizeGitCafeCommentEvent(comment, receivedAt) : null;
	};
	return {
		prepareCheckRerequest: async (eventId) => {
			const stored = await eventServices.getEventById(db, eventId);
			const parsed = gitCafeCheckRerequestedEventSchema.safeParse(stored?.raw);
			if (
				!parsed.success ||
				stored?.forge !== "gitcafe" ||
				stored.rawKind !== "check.rerequested" ||
				stored.quarantined
			)
				return { ok: false, reason: "invalid-response" };
			const event = parsed.data;
			const bound = await bind(
				`${event.repository.owner}/${event.repository.name}`,
			);
			if (!bound.ok) return bound;
			if (
				bound.repositoryId !== event.repository.id ||
				bound.installation.id !== event.installation.id
			)
				return { ok: false, reason: "identity-mismatch" };
			const input = { eventId, generation: bound.generation };
			const existing = await gitCafeActionServices.prepareGitCafeCheckRerun(
				db,
				{ ...input, mode: "existing" },
			);
			if (existing) return { ok: true, value: existing };
			const target = await gitCafeActionServices.prepareGitCafeCheckRerun(db, {
				...input,
				mode: "preview",
			});
			if (!target) return { ok: false, reason: "inactive" };
			const verified = await verifyGitCafeCheckRerequest(
				bound.client,
				bound.installation,
				event,
				target.number,
				Date.now() + 300_000,
			);
			if (!verified.ok) return verified;
			const job = await gitCafeActionServices.prepareGitCafeCheckRerun(db, {
				...input,
				mode: "create",
			});
			return job ? { ok: true, value: job } : { ok: false, reason: "inactive" };
		},
		refreshEvent: async (event) => {
			if (!("changeRequest" in event))
				return { ok: false, reason: "invalid-response" };
			const bound = await bind(event.repo.fullName);
			if (!bound.ok) return bound;
			const response = await bound.client.request(
				bound.installation.id,
				{
					method: "GET",
					resourcePath: `repos/${event.repo.fullName}/pulls/${event.changeRequest.number}`,
				},
				bound.installation,
				Date.now() + 300_000,
			);
			if (!response.ok) return response;
			const pull = gitCafePullIdentitySchema.safeParse(response.value);
			if (!pull.success) return { ok: false, reason: "invalid-response" };
			if (
				pull.data.repoId !== bound.repositoryId ||
				pull.data.number !== event.changeRequest.number ||
				pull.data.authorActorId !== event.actor.externalId ||
				pull.data.author.actorId !== event.actor.externalId ||
				pull.data.headOid === null
			)
				return { ok: false, reason: "identity-mismatch" };
			if (pull.data.state !== "open")
				return { ok: false, reason: "stale-event" };
			const current = normalizedEventSchema.parse({
				...event,
				changeRequest: {
					...event.changeRequest,
					headSha: pull.data.headOid,
					title: pull.data.title,
					draft: pull.data.draft,
					baseRef: pull.data.targetBranch,
					headRef: pull.data.sourceBranch,
				},
			});
			return "repo" in current
				? { ok: true, value: current }
				: { ok: false, reason: "invalid-response" };
		},
		adapter: {
			forge: "gitcafe",
			...reads,
			readFile,
			execute,
			normalizeWebhook: normalize,
			verifyWebhook: (raw, secret) =>
				raw.timestamp != null &&
				raw.keyVersion != null &&
				verifyGitCafeWebhook({
					body: new TextEncoder().encode(raw.body),
					timestamp: raw.timestamp,
					keyVersion: raw.keyVersion,
					signature: raw.signature ?? "",
					secrets: new Map([[raw.keyVersion, secret]]),
					now: Date.now(),
					maxAgeSeconds: 300,
					maxFutureSeconds: 30,
				}),
		},
		reads,
		signalHttp: null,
		installationRepos: null,
		isRepoPublic: null,
		getCatalogs: async (repoId) => {
			const repo = await repoServices.getRepoById(db, repoId);
			if (!repo || repo.forge !== "gitcafe" || repo.removedAt)
				return { ok: false, reason: "inactive" };
			const bound = await bind(repo.fullName);
			if (!bound.ok) return bound;
			if (
				bound.binding.repoId !== repo.id ||
				bound.binding.repositoryId !== repo.externalId ||
				bound.binding.installationId !== repo.installationId ||
				bound.binding.organizationId !== repo.orgId
			)
				return { ok: false, reason: "identity-mismatch" };
			const branches = await bound.reads.getBranches(
				repo.fullName,
				repo.externalId,
			);
			const labels = await bound.reads.getLabels(
				repo.fullName,
				repo.externalId,
			);
			for (const read of [branches, labels]) {
				if (
					!read.ok &&
					["stale", "inactive", "identity-mismatch", "expired"].includes(
						read.reason,
					)
				)
					return read;
			}
			const current = await bound.client.getToken(
				bound.installation.id,
				bound.installation,
			);
			if (!current.ok) return current;
			if (
				!(await gitCafeLifecycleServices.matchesGitCafeRepositoryBinding(
					db,
					bound.binding,
				))
			)
				return { ok: false, reason: "inactive" };
			return { ok: true, value: { binding: bound.binding, branches, labels } };
		},
		listThreads: async (repo, query) => {
			const bound = await bind(repo);
			return bound.ok
				? bound.reads.listThreads(repo, bound.repositoryId, query)
				: bound;
		},
		prepareEvent: async (raw, receivedAt) => {
			if (raw.eventName === "schedule.matched") {
				const scheduled = parseJson(raw.body, scheduledEventSchema);
				if (
					!scheduled ||
					scheduled.forge !== "gitcafe" ||
					!scheduled.thread.externalId
				)
					return { ok: false, reason: "invalid-response" };
				const bound = await bind(scheduled.repo.fullName);
				if (!bound.ok) return bound;
				if (
					scheduled.repoExternalId !== bound.repositoryId ||
					scheduled.installationExternalId !== bound.installation.id
				)
					return { ok: false, reason: "identity-mismatch" };
				const current = await bound.reads.getThread(
					scheduled.repo.fullName,
					bound.repositoryId,
					scheduled.thread.kind,
					scheduled.thread.number,
					scheduled.thread.externalId,
				);
				if (!current.ok)
					return current.reason === "changed"
						? { ok: false, reason: "stale-event" }
						: current;
				const thread = scheduledThreadSchema.parse(current.value);
				if (
					current.value.authorExternalId !== scheduled.actor.externalId ||
					!isDeepStrictEqual(
						{ ...thread, labels: [...thread.labels].sort() },
						{
							...scheduled.thread,
							labels: [...scheduled.thread.labels].sort(),
						},
					)
				)
					return { ok: false, reason: "stale-event" };
				return { ok: true, value: scheduled };
			}
			const event = parseJson(
				raw.body,
				gitCafeDispatchableRepositoryEventSchema,
			);
			if (!event) return { ok: false, reason: "invalid-response" };
			const bound = await bind(
				`${event.repository.owner}/${event.repository.name}`,
			);
			if (!bound.ok) return bound;
			if (
				event.installation.id !== bound.installation.id ||
				event.repository.id !== bound.repositoryId
			)
				return { ok: false, reason: "identity-mismatch" };
			if (
				event.type === "pull.comment_created" ||
				event.type === "issue.comment_created"
			) {
				const hydrated = await hydrateGitCafeCommentEvent(
					bound.client,
					bound.installation,
					event,
					Date.now() + 300_000,
				);
				return hydrated.ok
					? {
							ok: true,
							value: normalizeGitCafeCommentEvent(hydrated.value, receivedAt),
						}
					: hydrated;
			}
			const hydrated = await hydrateGitCafePullEvent(
				bound.client,
				bound.installation,
				event,
				Date.now() + 300_000,
			);
			return hydrated.ok
				? {
						ok: true,
						value: normalizeGitCafePullEvent(hydrated.value, receivedAt),
					}
				: hydrated;
		},
	};
}

function parseJson<T>(body: string, schema: GitCafeReadBoundary<T>): T | null {
	try {
		const value: unknown = JSON.parse(body);
		const parsed = schema.safeParse(value);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
