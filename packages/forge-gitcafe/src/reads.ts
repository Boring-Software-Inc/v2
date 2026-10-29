import {
	type EventActor,
	type GitCafeConnectionRepository,
	type GitCafeInstallation,
	type GitCafeReadBoundary,
	type GitCafeReadChange,
	type GitCafeReadChanges,
	type GitCafeReadCommits,
	type GitCafeReadDiagnostic,
	type GitCafeReadDiffFile,
	type GitCafeReadPull,
	type GitCafeRepoReviewer,
	gitCafeActionLabelPageSchema,
	gitCafeCheckReportInputSchema,
	gitCafeOrganizationMembersSchema,
	gitCafeReadActorPageSchema,
	gitCafeReadBlobSchema,
	gitCafeReadChangesSchema,
	gitCafeReadCollaboratorsSchema,
	gitCafeReadCommitsSchema,
	gitCafeReadDiagnosticSchema,
	gitCafeReadDiffFileSchema,
	gitCafeReadIssueThreadPageSchema,
	gitCafeReadIssueThreadSchema,
	gitCafeReadLabelPageSchema,
	gitCafeReadProfileSchema,
	gitCafeReadPullPageSchema,
	gitCafeReadPullSchema,
	gitCafeReadPullThreadPageSchema,
	gitCafeReadPullThreadSchema,
	gitCafeReadRefPageSchema,
	gitCafeReadReviewerPageSchema,
	gitCafeRepoReviewerSchema,
	type RepoLabel,
} from "@tripwire/contracts";
import type {
	ChangeRequestHead,
	ContributorProfile,
	DiffFile,
	ForgeCommit,
	ForgeThread,
	ThreadListQuery,
	ThreadListResult,
} from "@tripwire/forge";
import type {
	GitCafeInstallationClient,
	GitCafeInstallationFailure,
	GitCafeReadResource,
} from "./installation-client.ts";

export type GitCafeReadFailure =
	| GitCafeInstallationFailure
	| {
			ok: false;
			reason: "changed" | "incomplete" | "pagination" | "author-unavailable";
	  };
export type GitCafeReadResult<T> =
	| { ok: true; value: T; diagnostics?: GitCafeReadDiagnostic[] }
	| GitCafeReadFailure;
export interface GitCafeDiffFile
	extends Omit<DiffFile, "status" | "additions" | "deletions"> {
	status: DiffFile["status"] | null;
	additions: number | null;
	deletions: number | null;
	patchUnavailable: "binary" | "too-large" | "omitted" | "unavailable" | null;
	detailFailure?: GitCafeReadFailure;
}

export interface GitCafeReadsOptions {
	client: GitCafeInstallationClient;
	installationId: string;
	expectedInstallation?: GitCafeInstallation;
}

type Snapshot = Pick<
	GitCafeReadChanges,
	"id" | "version" | "headOid" | "baseOid" | "comparisonBaseOid"
>;

interface RepositoryReadContext {
	installation: GitCafeInstallation;
	repository: GitCafeConnectionRepository;
	root: string;
	deadlineAt: number;
}

export class GitCafeReads {
	constructor(private readonly options: GitCafeReadsOptions) {}

	getRef(
		repo: string,
		expectedRepositoryId: string,
		ref: string,
	): Promise<GitCafeReadResult<{ ref: string; oid: string } | null>> {
		const kind = ref.startsWith("refs/heads/")
			? "branches"
			: ref.startsWith("refs/tags/")
				? "tags"
				: null;
		const name = ref.slice(kind === "branches" ? 11 : 10);
		if (!kind || !name || name.length > 255)
			return Promise.resolve({ ok: false, reason: "invalid-response" });
		return this.browse(repo, expectedRepositoryId, async (context) => {
			const page = await this.resourcePages(
				context,
				"refs",
				gitCafeReadRefPageSchema,
				(item) => item.name,
				{ kind },
			);
			if (!page.ok) return page;
			const current = page.value.find((item) => item.name === name);
			return { ok: true, value: current ? { ref, oid: current.oid } : null };
		});
	}

	getActor(
		repo: string,
		expectedRepositoryId: string,
		actorId: string,
	): Promise<GitCafeReadResult<EventActor>> {
		if (!actorId)
			return Promise.resolve({ ok: false, reason: "author-unavailable" });
		return this.browse<EventActor>(
			repo,
			expectedRepositoryId,
			async (context) => {
				if (actorId === context.installation.bot.actorId)
					return {
						ok: true,
						value: {
							login: context.installation.bot.handle,
							externalId: actorId,
						},
					};
				const members = await this.resourcePages(
					{ ...context, root: `orgs/${context.installation.org}` },
					"members/",
					gitCafeReadActorPageSchema,
					(item) => item.actorId,
				);
				let candidate = members.ok
					? members.value.find((item) => item.actorId === actorId)
					: undefined;
				if (!candidate) {
					const collaborators = await this.resourcePages(
						context,
						"collaborators/",
						gitCafeReadActorPageSchema,
						(item) => item.actorId,
					);
					if (!collaborators.ok) return collaborators;
					candidate = collaborators.value.find(
						(item) => item.actorId === actorId,
					);
				}
				if (!candidate?.handle)
					return members.ok
						? { ok: false, reason: "author-unavailable" }
						: members;
				const profile = await this.resource(
					{ ...context, root: "users" },
					encodeURIComponent(candidate.handle),
					gitCafeReadProfileSchema,
				);
				if (!profile.ok) return profile;
				if (
					profile.value.actorId !== actorId ||
					profile.value.handle !== candidate.handle
				)
					return { ok: false, reason: "identity-mismatch" };
				return {
					ok: true,
					value: {
						login: profile.value.handle,
						externalId: actorId,
						avatarUrl: candidate.avatarUrl ?? undefined,
					},
				};
			},
		);
	}

	getThread(
		repo: string,
		expectedRepositoryId: string,
		kind: ForgeThread["kind"],
		number: number,
		expectedThreadId: string,
	): Promise<GitCafeReadResult<ForgeThread>> {
		if (
			!Number.isSafeInteger(number) ||
			number < 1 ||
			number > 2147483647 ||
			!expectedThreadId
		)
			return Promise.resolve({ ok: false, reason: "invalid-response" });
		return this.browse(repo, expectedRepositoryId, (context) =>
			this.thread(context, kind, number, expectedThreadId),
		);
	}

	private async thread(
		context: RepositoryReadContext,
		kind: ForgeThread["kind"],
		number: number,
		expectedThreadId: string,
		expectedActorId?: string | null,
	): Promise<GitCafeReadResult<ForgeThread>> {
		const isPull = kind === "change-request";
		const path = `${isPull ? "pulls" : "issues"}/${number}`;
		const current = isPull
			? await this.resource(context, path, gitCafeReadPullThreadSchema)
			: await this.resource(context, path, gitCafeReadIssueThreadSchema);
		if (!current.ok) return current;
		const detail = current.value;
		if (
			detail.id !== expectedThreadId ||
			detail.number !== number ||
			detail.repoId !== context.repository.id ||
			!detail.authorActorId ||
			(expectedActorId !== undefined &&
				detail.authorActorId !== expectedActorId) ||
			detail.author.actorId !== detail.authorActorId ||
			!detail.author.handle
		)
			return { ok: false, reason: "identity-mismatch" };
		const labels = await this.resourcePages(
			context,
			`${path}/labels`,
			gitCafeActionLabelPageSchema,
			(label) => label.id,
		);
		if (!labels.ok) return labels;
		const after = isPull
			? await this.resource(context, path, gitCafeReadPullThreadSchema)
			: await this.resource(context, path, gitCafeReadIssueThreadSchema);
		if (!after.ok) return after;
		if (JSON.stringify(after.value) !== JSON.stringify(detail))
			return { ok: false, reason: "changed" };
		const state =
			"state" in detail
				? detail.state === "open"
					? "open"
					: "closed"
				: ["completed", "canceled"].includes(detail.stateType)
					? "closed"
					: "open";
		return {
			ok: true,
			value: {
				externalId: detail.id,
				kind,
				number,
				title: detail.title,
				state,
				url: `https://git.cafe/${context.repository.owner}/${context.repository.name}/${isPull ? "pull" : "issues"}/${number}`,
				author: detail.author.handle,
				authorExternalId: detail.authorActorId,
				authorAvatarUrl: detail.author.avatarUrl ?? undefined,
				labels: labels.value.map((label) => label.name),
				locked: detail.lockedAt !== null,
				updatedAt: detail.updatedAt,
			},
		};
	}

	getBranches(
		repo: string,
		expectedRepositoryId: string,
	): Promise<GitCafeReadResult<string[]>> {
		return this.browse(repo, expectedRepositoryId, async (context) => {
			const page = await this.resourcePages(
				context,
				"refs",
				gitCafeReadRefPageSchema,
				(item) => item.name,
				{ kind: "branches" },
			);
			return page.ok
				? { ok: true, value: page.value.map((item) => item.name).sort() }
				: page;
		});
	}

	/** Suggestions come from current open PRs; dispatch still checks each target's own candidate list. */
	getReviewers(
		repo: string,
		expectedRepositoryId: string,
	): Promise<GitCafeReadResult<GitCafeRepoReviewer[]>> {
		return this.browse(repo, expectedRepositoryId, async (context) => {
			const pulls = await this.resourcePages(
				context,
				"pulls/",
				gitCafeReadPullThreadPageSchema,
				(item) => item.id,
				{ sort: "oldest" },
			);
			if (!pulls.ok) return pulls;
			const reviewers = new Map<
				string,
				{ reviewer: GitCafeRepoReviewer; evidence: string }
			>();
			for (const pull of pulls.value) {
				if (pull.state !== "open") continue;
				const path = `pulls/${pull.number}`;
				const before = await this.resource(
					context,
					path,
					gitCafeReadPullThreadSchema,
				);
				if (!before.ok) return before;
				if (
					before.value.id !== pull.id ||
					before.value.number !== pull.number ||
					before.value.repoId !== context.repository.id ||
					before.value.version !== pull.version ||
					before.value.state !== "open"
				)
					return { ok: false, reason: "changed" };
				const candidates = await this.resourcePages(
					context,
					`${path}/reviewer-candidates`,
					gitCafeReadReviewerPageSchema,
					(item) => item.id,
				);
				if (!candidates.ok) return candidates;
				for (const item of candidates.value) {
					const parsed = gitCafeRepoReviewerSchema.safeParse({
						id: item.id,
						login: item.handle ?? item.id,
						avatarUrl: item.avatarUrl
							? new URL(item.avatarUrl, "https://git.cafe").href
							: "",
						permission: "review-candidate",
					});
					if (!parsed.success) return { ok: false, reason: "invalid-response" };
					const existing = reviewers.get(item.id);
					const evidence = JSON.stringify(item);
					if (existing && existing.evidence !== evidence)
						return { ok: false, reason: "changed" };
					reviewers.set(item.id, { reviewer: parsed.data, evidence });
				}
				const after = await this.resource(
					context,
					path,
					gitCafeReadPullThreadSchema,
				);
				if (!after.ok) return after;
				if (JSON.stringify(before.value) !== JSON.stringify(after.value))
					return { ok: false, reason: "changed" };
			}
			return {
				ok: true,
				value: [...reviewers.values()]
					.map((entry) => entry.reviewer)
					.sort((a, b) => a.login.localeCompare(b.login)),
			};
		});
	}

	getLabels(
		repo: string,
		expectedRepositoryId: string,
	): Promise<GitCafeReadResult<RepoLabel[]>> {
		return this.browse(repo, expectedRepositoryId, async (context) => {
			const page = await this.resourcePages(
				context,
				"labels",
				gitCafeReadLabelPageSchema,
				(item) => item.id,
			);
			if (!page.ok) return page;
			const labels: RepoLabel[] = [];
			for (const item of page.value) {
				if (item.repoId !== context.repository.id)
					return { ok: false, reason: "identity-mismatch" };
				const color = /^#?([a-fA-F0-9]{6})$/.exec(item.color)?.[1];
				if (!color) return { ok: false, reason: "invalid-response" };
				labels.push({
					name: item.name,
					color: color.toLowerCase(),
					description: item.description,
				});
			}
			return {
				ok: true,
				value: labels.sort((a, b) => a.name.localeCompare(b.name)),
			};
		});
	}

	listThreads(
		repo: string,
		expectedRepositoryId: string,
		query: ThreadListQuery,
	): Promise<GitCafeReadResult<ThreadListResult>> {
		if (
			!Number.isSafeInteger(query.cap) ||
			query.cap < 0 ||
			(query.updatedBefore !== null &&
				!Number.isFinite(Date.parse(query.updatedBefore)))
		)
			return Promise.resolve({ ok: false, reason: "invalid-response" });
		if (query.cap === 0)
			return Promise.resolve({
				ok: true,
				value: { threads: [], stopped: null },
			});
		return this.browse(repo, expectedRepositoryId, async (context) => {
			const threads: ForgeThread[] = [];
			for (const kind of new Set(query.subjects)) {
				const isPull = kind === "change-request";
				const path = isPull ? "pulls" : "issues";
				const listed = isPull
					? await this.resourcePages(
							context,
							`${path}/`,
							gitCafeReadPullThreadPageSchema,
							(item) => item.id,
							{ sort: "oldest" },
						)
					: await this.resourcePages(
							context,
							`${path}/`,
							gitCafeReadIssueThreadPageSchema,
							(item) => item.id,
							{ sort: "updated" },
						);
				if (!listed.ok) return listed;
				const numbers = new Set<number>();
				for (const item of listed.value) {
					if (numbers.has(item.number))
						return { ok: false, reason: "identity-mismatch" };
					numbers.add(item.number);
					const current = await this.thread(
						context,
						kind,
						item.number,
						item.id,
						item.authorActorId,
					);
					if (!current.ok) return current;
					const thread = current.value;
					const labelSet = new Set(
						thread.labels.map((name) => name.toLowerCase()),
					);
					if (
						(query.state !== "any" && thread.state !== query.state) ||
						(query.skipLocked && thread.locked) ||
						(query.updatedBefore !== null &&
							Date.parse(thread.updatedAt) >=
								Date.parse(query.updatedBefore)) ||
						!query.labels.every((name) => labelSet.has(name.toLowerCase())) ||
						query.excludeLabels.some((name) => labelSet.has(name.toLowerCase()))
					)
						continue;
					threads.push(thread);
				}
			}
			threads.sort(
				(a, b) =>
					Date.parse(a.updatedAt) - Date.parse(b.updatedAt) ||
					a.kind.localeCompare(b.kind) ||
					a.number - b.number,
			);
			return {
				ok: true,
				value: { threads: threads.slice(0, query.cap), stopped: null },
			};
		});
	}

	/** Every page shares one installation snapshot; name reuse cannot redirect a completed catalog read. */
	private browse<T>(
		repo: string,
		expectedRepositoryId: string,
		read: (context: RepositoryReadContext) => Promise<GitCafeReadResult<T>>,
	): Promise<GitCafeReadResult<T>> {
		return this.fenced(async () => {
			if (
				!gitCafeCheckReportInputSchema.shape.repoFullName.safeParse(repo)
					.success ||
				!expectedRepositoryId
			)
				return { ok: false, reason: "invalid-response" };
			const owner = repo.split("/")[0];
			const name = repo.split("/")[1];
			if (!owner || !name) return { ok: false, reason: "invalid-response" };
			const deadlineAt = Date.now() + 300_000;
			const installation = this.options.expectedInstallation
				? { ok: true as const, value: this.options.expectedInstallation }
				: await this.options.client.getInstallation(
						this.options.installationId,
						deadlineAt,
					);
			if (!installation.ok) return installation;
			const repository = await this.options.client.getRepository(
				this.options.installationId,
				owner,
				name,
				installation.value,
				deadlineAt,
			);
			if (!repository.ok) return repository;
			if (
				repository.value.id !== expectedRepositoryId ||
				repository.value.archivedAt !== null
			)
				return { ok: false, reason: "identity-mismatch" };
			const result = await read({
				installation: installation.value,
				repository: repository.value,
				root: `repos/${repo}`,
				deadlineAt,
			});
			if (!result.ok) return result;
			const current = await this.options.client.getRepository(
				this.options.installationId,
				owner,
				name,
				installation.value,
				deadlineAt,
			);
			if (!current.ok) return current;
			return current.value.id === repository.value.id &&
				current.value.archivedAt === null
				? result
				: { ok: false, reason: "identity-mismatch" };
		});
	}

	private async resource<T>(
		context: RepositoryReadContext,
		path: string,
		schema: GitCafeReadBoundary<T>,
	): Promise<GitCafeReadResult<T>> {
		const response = await this.options.client.request(
			this.options.installationId,
			{ method: "GET", resourcePath: `${context.root}/${path}` },
			context.installation,
			context.deadlineAt,
		);
		if (!response.ok) return response;
		const parsed = schema.safeParse(response.value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: { ok: false, reason: "invalid-response" };
	}

	private resourcePages<T>(
		context: RepositoryReadContext,
		path: string,
		schema: GitCafeReadBoundary<{ items: T[]; next: string | null }>,
		identity: (item: T) => string,
		parameters: Record<string, string> = {},
	): Promise<GitCafeReadResult<T[]>> {
		return readPages((after) => {
			const query = new URLSearchParams({ ...parameters, limit: "100" });
			if (after !== undefined) query.set("after", after);
			return this.resource(context, `${path}?${query}`, schema);
		}, identity);
	}

	getDiff(
		repo: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<GitCafeReadResult<GitCafeDiffFile[]>> {
		return this.fenced(() => this.diff(repo, number, head));
	}
	getCommits(
		repo: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<GitCafeReadResult<ForgeCommit[]>> {
		return this.fenced(() => this.commits(repo, number, head));
	}
	readFile(
		repo: string,
		path: string,
		exactOid: string,
	): Promise<GitCafeReadResult<string>> {
		return this.fenced(() => this.file(repo, path, exactOid));
	}
	getContributorProfile(
		repo: string,
		login: string,
		expectedActorId?: string,
	): Promise<GitCafeReadResult<ContributorProfile>> {
		return this.fenced(() => this.contributor(repo, login, expectedActorId));
	}

	private async fenced<T>(
		read: () => Promise<GitCafeReadResult<T>>,
	): Promise<GitCafeReadResult<T>> {
		const generation = this.options.client.generation(
			this.options.installationId,
		);
		const result = await read();
		if (!result.ok) return result;
		return this.options.client.generation(this.options.installationId) ===
			generation
			? result
			: { ok: false, reason: "stale" };
	}

	private async get<T>(
		repo: string,
		resource: GitCafeReadResource,
		schema: GitCafeReadBoundary<T>,
	): Promise<GitCafeReadResult<T>> {
		const result = await this.options.client.readResource(
			this.options.installationId,
			repo,
			resource,
		);
		if (!result.ok) return result;
		const parsed = schema.safeParse(result.value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: { ok: false, reason: "invalid-response" };
	}

	private async pull(
		repo: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<GitCafeReadResult<GitCafeReadPull>> {
		const result = await this.get(
			repo,
			{ kind: "pull", number },
			gitCafeReadPullSchema,
		);
		if (!result.ok) return result;
		if (
			result.value.number !== number ||
			result.value.headOid === null ||
			(head &&
				(head.sha !== result.value.headOid ||
					head.baseRef !== result.value.targetBranch))
		)
			return { ok: false, reason: "changed" };
		return result;
	}

	private async stable(
		repo: string,
		number: number,
		pull: GitCafeReadPull,
		snapshot: Snapshot,
		kind: "changes" | "commits",
	): Promise<GitCafeReadResult<true>> {
		const current = await this.pull(repo, number);
		if (!current.ok) return current;
		if (
			current.value.id !== pull.id ||
			current.value.repoId !== pull.repoId ||
			current.value.version !== pull.version ||
			current.value.headOid !== pull.headOid ||
			current.value.targetBranch !== pull.targetBranch ||
			current.value.observedBaseOid !== pull.observedBaseOid
		)
			return { ok: false, reason: "changed" };
		const probe =
			kind === "changes"
				? await this.get(
						repo,
						{ kind, number, version: pull.version },
						gitCafeReadChangesSchema,
					)
				: await this.get(
						repo,
						{ kind, number, version: pull.version },
						gitCafeReadCommitsSchema,
					);
		if (!probe.ok) return probe;
		return sameSnapshot(probe.value, snapshot)
			? { ok: true, value: true }
			: { ok: false, reason: "changed" };
	}

	private async diff(
		repo: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<GitCafeReadResult<GitCafeDiffFile[]>> {
		const pull = await this.pull(repo, number, head);
		if (!pull.ok) return pull;
		const files: GitCafeDiffFile[] = [];
		const paths = new Set<string>();
		const cursors = new Set<string>();
		let after: string | undefined;
		let snapshot: Snapshot | undefined;
		do {
			const result = await this.get(
				repo,
				{ kind: "changes", number, version: pull.value.version, after },
				gitCafeReadChangesSchema,
			);
			if (!result.ok) return result;
			const page = result.value;
			if (
				!matchesPull(page, pull.value) ||
				(snapshot && !sameSnapshot(page, snapshot))
			)
				return { ok: false, reason: "changed" };
			snapshot = page;
			if (page.next !== null && (!page.items.length || cursors.has(page.next)))
				return { ok: false, reason: "pagination" };
			for (const change of page.items) {
				if (paths.has(change.path)) return { ok: false, reason: "pagination" };
				paths.add(change.path);
				const detail = await this.get(
					repo,
					{
						kind: "diff-file",
						number,
						version: page.version,
						path: change.path,
					},
					gitCafeReadDiffFileSchema,
				);
				if (!detail.ok) {
					if (
						["stale", "inactive", "identity-mismatch"].includes(detail.reason)
					)
						return detail;
					if (detail.reason === "http" && detail.status === 409)
						return { ok: false, reason: "changed" };
					files.push(unavailableDiffFile(change, detail));
					continue;
				}
				if (
					!sameSnapshot(detail.value, page) ||
					detail.value.file.path !== change.path
				)
					return { ok: false, reason: "changed" };
				const file = diffFile(change, detail.value.file);
				if (!file.ok) return file;
				files.push(file.value);
			}
			after = page.next ?? undefined;
			if (after) cursors.add(after);
		} while (after);
		if (!snapshot) return { ok: false, reason: "incomplete" };
		if (
			(pull.value.changedFiles !== null &&
				pull.value.changedFiles !== files.length) ||
			(pull.value.additions !== null &&
				files.every((f) => f.additions !== null) &&
				pull.value.additions !==
					files.reduce((n, f) => n + (f.additions ?? 0), 0)) ||
			(pull.value.deletions !== null &&
				files.every((f) => f.deletions !== null) &&
				pull.value.deletions !==
					files.reduce((n, f) => n + (f.deletions ?? 0), 0))
		)
			return { ok: false, reason: "incomplete" };
		const stable = await this.stable(
			repo,
			number,
			pull.value,
			snapshot,
			"changes",
		);
		return stable.ok ? { ok: true, value: files } : stable;
	}

	private async commits(
		repo: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<GitCafeReadResult<ForgeCommit[]>> {
		const pull = await this.pull(repo, number, head);
		if (!pull.ok) return pull;
		const commits: ForgeCommit[] = [];
		const ids = new Set<string>();
		const cursors = new Set<string>();
		let after: string | undefined;
		let snapshot: GitCafeReadCommits | undefined;
		do {
			const result = await this.get(
				repo,
				{ kind: "commits", number, version: pull.value.version, after },
				gitCafeReadCommitsSchema,
			);
			if (!result.ok) return result;
			const page = result.value;
			if (
				!matchesPull(page, pull.value) ||
				(snapshot && !sameSnapshot(page, snapshot))
			)
				return { ok: false, reason: "changed" };
			if (page.truncated) return { ok: false, reason: "incomplete" };
			if (page.next !== null && (!page.items.length || cursors.has(page.next)))
				return { ok: false, reason: "pagination" };
			snapshot = page;
			for (const commit of page.items) {
				if (ids.has(commit.oid)) return { ok: false, reason: "pagination" };
				ids.add(commit.oid);
				commits.push({
					sha: commit.oid,
					message: commit.message,
					authorLogin: null,
					authorEmail: commit.author.email || null,
					authoredAt: new Date(commit.author.timestamp * 1000).toISOString(),
				});
			}
			after = page.next ?? undefined;
			if (after) cursors.add(after);
		} while (after);
		if (!snapshot) return { ok: false, reason: "incomplete" };
		const stable = await this.stable(
			repo,
			number,
			pull.value,
			snapshot,
			"commits",
		);
		return stable.ok ? { ok: true, value: commits } : stable;
	}

	private async file(
		repo: string,
		path: string,
		exactOid: string,
	): Promise<GitCafeReadResult<string>> {
		const result = await this.get(
			repo,
			{ kind: "blob", path, oid: exactOid },
			gitCafeReadBlobSchema,
		);
		if (!result.ok) return result;
		const blob = result.value;
		if (blob.commit !== exactOid || blob.path !== path)
			return { ok: false, reason: "changed" };
		if (
			blob.binary ||
			blob.content === null ||
			Buffer.byteLength(blob.content) !== blob.size
		)
			return { ok: false, reason: "incomplete" };
		return { ok: true, value: blob.content };
	}

	private async contributor(
		repo: string,
		login: string,
		expectedActorId?: string,
	): Promise<GitCafeReadResult<ContributorProfile>> {
		const profile = await this.get(
			repo,
			{ kind: "profile", login },
			gitCafeReadProfileSchema,
		);
		if (!profile.ok) return profile;
		if (
			profile.value.handle !== login ||
			(expectedActorId !== undefined &&
				profile.value.actorId !== expectedActorId)
		)
			return { ok: false, reason: "identity-mismatch" };
		const actor = profile.value.actorId;
		const [merged, members, collaborators] = await Promise.all([
			this.pages(
				repo,
				"merged-pulls",
				gitCafeReadPullPageSchema,
				(item) => item.id,
			),
			this.pages(
				repo,
				"members",
				gitCafeOrganizationMembersSchema,
				(item) => item.actorId,
			),
			this.pages(
				repo,
				"collaborators",
				gitCafeReadCollaboratorsSchema,
				(item) => item.actorId,
			),
		]);
		const diagnostics: GitCafeReadDiagnostic[] = [];
		for (const [source, read] of [
			["merged-history", merged],
			["organization-membership", members],
			["repository-collaborators", collaborators],
		] as const) {
			if (!read.ok)
				diagnostics.push(
					gitCafeReadDiagnosticSchema.parse({
						source,
						reason: read.reason,
						status: "status" in read ? read.status : undefined,
					}),
				);
		}
		const validHistory =
			merged.ok && merged.value.every((p) => p.state === "merged");
		if (merged.ok && !validHistory)
			diagnostics.push(
				gitCafeReadDiagnosticSchema.parse({
					source: "merged-history",
					reason: "invalid-response",
				}),
			);
		const membership = members.ok
			? members.value.find((m) => m.actorId === actor)
			: undefined;
		const collaborator = collaborators.ok
			? collaborators.value.find((c) => c.actorId === actor)
			: undefined;
		const isOrgMember = members.ok
			? membership !== undefined &&
				[
					"org-owner",
					"org-admin",
					"org-member-read",
					"org-member-write",
					"org-member-none",
				].includes(membership.role)
			: null;
		const directMaintainer =
			collaborator &&
			["repo-writer", "repo-maintainer", "repo-admin"].includes(
				collaborator.role,
			);
		const inheritedMaintainer =
			membership && ["org-owner", "org-admin"].includes(membership.role);
		const isMaintainer = directMaintainer || inheritedMaintainer ? true : null;
		const result: GitCafeReadResult<ContributorProfile> = {
			ok: true,
			value: {
				login,
				externalId: actor,
				createdAt: null,
				followers: null,
				following: null,
				publicRepos: null,
				profileText: profile.value.bio,
				mergedInRepo:
					merged.ok && validHistory
						? merged.value.filter((p) => p.authorActorId === actor).length
						: null,
				mergedElsewhere: null,
				recentChangeRequestTimes: null,
				isOrgMember,
				isMaintainer,
			},
		};
		if (diagnostics.length > 0) result.diagnostics = diagnostics;
		return result;
	}

	private pages<T>(
		repo: string,
		kind: "merged-pulls" | "members" | "collaborators",
		schema: GitCafeReadBoundary<{ items: T[]; next: string | null }>,
		identity: (item: T) => string,
	): Promise<GitCafeReadResult<T[]>> {
		return readPages(
			(after) => this.get(repo, { kind, after }, schema),
			identity,
		);
	}
}

async function readPages<T>(
	fetchPage: (
		after: string | undefined,
	) => Promise<GitCafeReadResult<{ items: T[]; next: string | null }>>,
	identity: (item: T) => string,
): Promise<GitCafeReadResult<T[]>> {
	const items: T[] = [];
	const cursors = new Set<string>();
	const ids = new Set<string>();
	let after: string | undefined;
	do {
		const result = await fetchPage(after);
		if (!result.ok) return result;
		const page = result.value;
		if (page.next !== null && (!page.items.length || cursors.has(page.next)))
			return { ok: false, reason: "pagination" };
		for (const item of page.items) {
			const id = identity(item);
			if (ids.has(id)) return { ok: false, reason: "pagination" };
			ids.add(id);
			items.push(item);
		}
		after = page.next ?? undefined;
		if (after) cursors.add(after);
	} while (after);
	return { ok: true, value: items };
}

function matchesPull(snapshot: Snapshot, pull: GitCafeReadPull): boolean {
	return (
		snapshot.id === pull.id &&
		snapshot.version === pull.version &&
		snapshot.headOid === pull.headOid &&
		(pull.observedBaseOid === null || pull.observedBaseOid === snapshot.baseOid)
	);
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
	return (
		a.id === b.id &&
		a.version === b.version &&
		a.headOid === b.headOid &&
		a.baseOid === b.baseOid &&
		a.comparisonBaseOid === b.comparisonBaseOid
	);
}

function unavailableDiffFile(
	change: GitCafeReadChange,
	failure?: GitCafeReadFailure,
): GitCafeDiffFile {
	const status = change.status;
	const projected: GitCafeDiffFile = {
		path: change.path,
		status:
			!status || status === "conflicted"
				? null
				: status === "deleted"
					? "removed"
					: status === "copied"
						? "added"
						: status === "typeChanged"
							? "modified"
							: status,
		additions: change.additions ?? null,
		deletions: change.deletions ?? null,
		patchUnavailable: change.binary
			? "binary"
			: change.tooLarge
				? "too-large"
				: "unavailable",
	};
	if (change.oldPath) projected.previousPath = change.oldPath;
	if (failure) projected.detailFailure = failure;
	return projected;
}

function diffFile(
	change: GitCafeReadChange,
	file: GitCafeReadDiffFile["file"],
): GitCafeReadResult<GitCafeDiffFile> {
	const status = file.status ?? change.status;
	if (
		(change.status !== undefined &&
			file.status !== undefined &&
			change.status !== file.status) ||
		(change.oldPath !== undefined &&
			file.oldPath !== undefined &&
			change.oldPath !== file.oldPath) ||
		(change.binary !== undefined &&
			file.binary !== undefined &&
			change.binary !== file.binary)
	)
		return { ok: false, reason: "changed" };
	if (
		(change.additions !== undefined &&
			file.additions !== undefined &&
			change.additions !== file.additions) ||
		(change.deletions !== undefined &&
			file.deletions !== undefined &&
			change.deletions !== file.deletions)
	)
		return { ok: false, reason: "changed" };
	const binary = file.binary ?? change.binary;
	const tooLarge = file.tooLarge || change.tooLarge;
	const unavailable =
		binary ||
		tooLarge ||
		file.hunksOmitted === true ||
		(file.hunksOmitted !== false &&
			((file.additions ?? change.additions) === undefined ||
				(file.deletions ?? change.deletions) === undefined)) ||
		file.hunks === undefined;
	const projected = unavailableDiffFile({ ...change, ...file, status });
	if (unavailable)
		return {
			ok: true,
			value: {
				...projected,
				patchUnavailable: binary
					? "binary"
					: tooLarge
						? "too-large"
						: file.hunksOmitted
							? "omitted"
							: "unavailable",
			},
		};
	let additions = 0;
	let deletions = 0;
	const hunks: string[] = [];
	let oldEnd = 0;
	let newEnd = 0;
	for (const hunk of file.hunks ?? []) {
		let oldLines = 0;
		let newLines = 0;
		if (hunk.oldStart < oldEnd || hunk.newStart < newEnd)
			return { ok: false, reason: "invalid-response" };
		const lines: string[] = [];
		for (const line of hunk.lines) {
			if (line.content.replace(/\r?\n$/, "").includes("\n"))
				return { ok: false, reason: "invalid-response" };
			if (line.origin !== "+") oldLines++;
			if (line.origin !== "-") newLines++;
			if (line.origin === "+") additions++;
			if (line.origin === "-") deletions++;
			lines.push(
				`${line.origin}${line.content}${line.content.endsWith("\n") ? "" : "\n"}`,
			);
		}
		if (oldLines !== hunk.oldLines || newLines !== hunk.newLines)
			return { ok: false, reason: "incomplete" };
		oldEnd = hunk.oldStart + oldLines;
		newEnd = hunk.newStart + newLines;
		hunks.push(
			`@@ -${hunk.oldStart},${oldLines} +${hunk.newStart},${newLines} @@\n${lines.join("")}`,
		);
	}
	if (
		[change.additions, file.additions].some(
			(n) => n !== undefined && n !== additions,
		) ||
		[change.deletions, file.deletions].some(
			(n) => n !== undefined && n !== deletions,
		)
	)
		return { ok: false, reason: "incomplete" };
	if (status === "renamed" && !projected.previousPath)
		return { ok: false, reason: "incomplete" };
	return {
		ok: true,
		value: {
			...projected,
			additions,
			deletions,
			patch: hunks.join(""),
			patchUnavailable: null,
		},
	};
}
