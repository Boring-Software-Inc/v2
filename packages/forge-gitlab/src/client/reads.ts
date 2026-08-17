import type {
	ContributorProfile,
	DiffFile,
	ForgeCommit,
} from "@tripwire/forge";
import { encodeProject, GitlabHttp, type GitlabHttpOptions } from "./http.ts";

/**
 * The adapter's read surface (§4): diff, commits, file contents, contributor
 * profile. The worker pre-fetches these into RuleContext (§5.8). Plain fetch
 * against the GitLab REST v4 API. One page (100 items) per read is the MVP
 * ceiling, the same as the GitHub adapter. Evidence records the truncation.
 *
 * Some GitHub signals have no exact GitLab match. This adapter returns honest
 * values and marks the gaps with TODO:
 *   - `publicRepos` needs the `x-total` header, which this client does not read
 *     yet. It returns 0 for now.
 *   - `followers` / `following` come from one page of the follow lists.
 */
export type GitlabReadsOptions = GitlabHttpOptions;

function mapStatus(file: {
	new_file: boolean;
	deleted_file: boolean;
	renamed_file: boolean;
}): DiffFile["status"] {
	if (file.new_file) {
		return "added";
	}
	if (file.deleted_file) {
		return "removed";
	}
	if (file.renamed_file) {
		return "renamed";
	}
	return "modified";
}

export class GitlabReads {
	private readonly http: GitlabHttp;

	constructor(options: GitlabReadsOptions) {
		this.http = new GitlabHttp(options);
	}

	private get(repoFullName: string, path: string): Promise<unknown> {
		return this.http.get(repoFullName, path);
	}

	async getDiff(repoFullName: string, number: number): Promise<DiffFile[]> {
		const project = encodeProject(repoFullName);
		const files = (await this.get(
			repoFullName,
			`/projects/${project}/merge_requests/${number}/diffs?per_page=100`,
		)) as {
			old_path: string;
			new_path: string;
			new_file: boolean;
			deleted_file: boolean;
			renamed_file: boolean;
			diff: string;
		}[];
		return files.map((file) => ({
			path: file.new_path,
			status: mapStatus(file),
			// GitLab does not return per-file add/delete counts on the diff list.
			// The patch text carries the changes. Counts stay 0 for the PoC.
			additions: 0,
			deletions: 0,
			patch: file.diff,
			previousPath: file.renamed_file ? file.old_path : undefined,
		}));
	}

	async getCommits(
		repoFullName: string,
		number: number,
	): Promise<ForgeCommit[]> {
		const project = encodeProject(repoFullName);
		const commits = (await this.get(
			repoFullName,
			`/projects/${project}/merge_requests/${number}/commits?per_page=100`,
		)) as {
			id: string;
			message: string;
			author_name: string | null;
			author_email: string | null;
			authored_date: string;
		}[];
		return commits.map((c) => ({
			sha: c.id,
			message: c.message,
			authorLogin: c.author_name ?? null,
			authorEmail: c.author_email ?? null,
			authoredAt: c.authored_date ?? "",
		}));
	}

	async readFile(
		repoFullName: string,
		path: string,
		ref: string,
	): Promise<string | null> {
		const project = encodeProject(repoFullName);
		const filePath = encodeURIComponent(path);
		try {
			const data = (await this.get(
				repoFullName,
				`/projects/${project}/repository/files/${filePath}?ref=${encodeURIComponent(ref)}`,
			)) as { content?: string; encoding?: string };
			if (data.content && data.encoding === "base64") {
				return Buffer.from(data.content, "base64").toString("utf8");
			}
			return null;
		} catch (error) {
			if (String(error).includes("404")) {
				return null;
			}
			throw error;
		}
	}

	async getContributorProfile(
		repoFullName: string,
		login: string,
	): Promise<ContributorProfile> {
		const project = encodeProject(repoFullName);
		// TWO calls, deliberately. `GET /users?username=` returns GitLab's LIMITED
		// public user — id, username, avatar and nothing else. `created_at` and
		// `bio` only appear on `GET /users/:id`. Reading them off the list response
		// yielded `undefined`, which made every GitLab contributor look like they
		// had no account age at all and quietly defeated account-age@1.
		const matches = (await this.get(
			repoFullName,
			`/users?username=${encodeURIComponent(login)}`,
		)) as { id: number }[];
		const match = matches[0];
		if (!match) {
			throw new Error(`gitlab user not found: ${login}`);
		}
		// KNOWN LIMITATION — do not "fix" this by going back to the list endpoint.
		// GitLab returns `created_at` on `/users/:id` only for the CALLER (or an
		// instance admin). For any other account the field is simply absent, so
		// `createdAt` is empty for real contributors and `account-age@1` skips with
		// "contributor createdAt unparseable". That skip is correct — §6 says rules
		// skip rather than guess — but it means account age is not a signal tripwire
		// can read on gitlab.com today. Verified live: self returns 23 fields with
		// created_at, another user returns 22 without it.
		const user = (await this.get(repoFullName, `/users/${match.id}`)) as {
			id: number;
			created_at: string;
			bio: string | null;
		};

		const [
			followers,
			following,
			mergedInRepo,
			mergedElsewhere,
			recent,
			member,
		] = await Promise.all([
			this.get(repoFullName, `/users/${user.id}/followers?per_page=100`).catch(
				() => null,
			) as Promise<unknown[] | null>,
			this.get(repoFullName, `/users/${user.id}/following?per_page=100`).catch(
				() => null,
			) as Promise<unknown[] | null>,
			// Merged MRs by this author in THIS project. One page is the ceiling.
			this.get(
				repoFullName,
				`/projects/${project}/merge_requests?author_username=${encodeURIComponent(login)}&state=merged&per_page=100`,
			).catch(() => null) as Promise<{ web_url: string }[] | null>,
			// Merged MRs by this author across GitLab, EXCLUDING the author's own
			// namespace. This is the "someone else accepted their work" signal
			// (min-merged-prs@2). null on failure ⇒ the rule skips, never guesses.
			this.get(
				repoFullName,
				`/merge_requests?author_username=${encodeURIComponent(login)}&state=merged&scope=all&per_page=100`,
			).catch(() => null) as Promise<{ web_url: string }[] | null>,
			this.get(
				repoFullName,
				`/merge_requests?author_username=${encodeURIComponent(login)}&scope=all&created_after=${recentWindowIso()}&per_page=100`,
			).catch(() => null) as Promise<{ created_at: string }[] | null>,
			// Access level in the project. 30 = developer (write), 40 = maintainer.
			this.get(
				repoFullName,
				`/projects/${project}/members/all/${user.id}`,
			).catch(() => null) as Promise<{ access_level: number } | null>,
		]);

		const accessLevel = member?.access_level ?? 0;
		const ownPrefix = `${login}/`.toLowerCase();
		const elsewhere =
			mergedElsewhere === null
				? null
				: mergedElsewhere.filter(
						(mr) => !mr.web_url.toLowerCase().includes(`/${ownPrefix}`),
					).length;

		return {
			login,
			externalId: String(user.id),
			createdAt: user.created_at,
			followers: followers?.length ?? 0,
			following: following?.length ?? 0,
			// TODO: needs the `x-total` header. The client does not read headers yet.
			publicRepos: 0,
			profileText: user.bio ?? null,
			mergedInRepo: mergedInRepo?.length ?? 0,
			mergedElsewhere: elsewhere,
			recentChangeRequestTimes: (recent ?? []).map((mr) => mr.created_at),
			isOrgMember: accessLevel >= 30,
			isMaintainer: accessLevel >= 40,
		};
	}
}

function recentWindowIso(): string {
	const dayMs = 86_400_000;
	return new Date(Date.now() - 7 * dayMs).toISOString();
}
