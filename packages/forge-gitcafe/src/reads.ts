import {
	type GitCafeReadBoundary,
	type GitCafeReadChange,
	type GitCafeReadChanges,
	type GitCafeReadCommits,
	type GitCafeReadDiagnostic,
	type GitCafeReadDiffFile,
	type GitCafeReadPull,
	gitCafeOrganizationMembersSchema,
	gitCafeReadBlobSchema,
	gitCafeReadChangesSchema,
	gitCafeReadCollaboratorsSchema,
	gitCafeReadCommitsSchema,
	gitCafeReadDiagnosticSchema,
	gitCafeReadDiffFileSchema,
	gitCafeReadProfileSchema,
	gitCafeReadPullPageSchema,
	gitCafeReadPullSchema,
} from "@tripwire/contracts";
import type {
	ChangeRequestHead,
	ContributorProfile,
	DiffFile,
	ForgeCommit,
} from "@tripwire/forge";
import type {
	GitCafeInstallationClient,
	GitCafeInstallationFailure,
	GitCafeReadResource,
} from "./installation-client.ts";

export type GitCafeReadFailure =
	| GitCafeInstallationFailure
	| { ok: false; reason: "changed" | "incomplete" | "pagination" };
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
}

type Snapshot = Pick<
	GitCafeReadChanges,
	"id" | "version" | "headOid" | "baseOid" | "comparisonBaseOid"
>;

export class GitCafeReads {
	constructor(private readonly options: GitCafeReadsOptions) {}

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

	private async pages<T>(
		repo: string,
		kind: "merged-pulls" | "members" | "collaborators",
		schema: GitCafeReadBoundary<{ items: T[]; next: string | null }>,
		identity: (item: T) => string,
	): Promise<GitCafeReadResult<T[]>> {
		const items: T[] = [];
		const cursors = new Set<string>();
		const ids = new Set<string>();
		let after: string | undefined;
		do {
			const result = await this.get(repo, { kind, after }, schema);
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
