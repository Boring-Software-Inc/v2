import type {
	ContributorProfile,
	DiffFile,
	ForgeCommit,
} from "@tripwire/forge";

/**
 * The adapter's read surface (§4): diff, commits, file contents, contributor
 * profile — everything the worker pre-fetches into RuleContext (§5.8). Plain
 * fetch against the REST API; no octokit. One page (100 items) per read is
 * the MVP ceiling — evidence records the truncation.
 */

import { GithubHttp, type GithubHttpOptions } from "./http.ts";

export type GithubReadsOptions = GithubHttpOptions;

const STATUS_MAP: Record<string, DiffFile["status"]> = {
	added: "added",
	modified: "modified",
	removed: "removed",
	renamed: "renamed",
	changed: "modified",
	copied: "added",
	unchanged: "modified",
};

export class GithubReads {
	private readonly http: GithubHttp;

	constructor(options: GithubReadsOptions) {
		this.http = new GithubHttp(options);
	}

	private get(repoFullName: string, path: string): Promise<unknown> {
		return this.http.get(repoFullName, path);
	}

	async getDiff(repoFullName: string, number: number): Promise<DiffFile[]> {
		const files = (await this.get(
			repoFullName,
			`/repos/${repoFullName}/pulls/${number}/files?per_page=100`,
		)) as {
			filename: string;
			status: string;
			additions: number;
			deletions: number;
			patch?: string;
			previous_filename?: string;
		}[];
		return files.map((file) => ({
			path: file.filename,
			status: STATUS_MAP[file.status] ?? "modified",
			additions: file.additions,
			deletions: file.deletions,
			patch: file.patch,
			previousPath: file.previous_filename,
		}));
	}

	async getCommits(
		repoFullName: string,
		number: number,
	): Promise<ForgeCommit[]> {
		const commits = (await this.get(
			repoFullName,
			`/repos/${repoFullName}/pulls/${number}/commits?per_page=100`,
		)) as {
			sha: string;
			commit: { message: string; author: { date: string } | null };
			author: { login: string } | null;
		}[];
		return commits.map((c) => ({
			sha: c.sha,
			message: c.commit.message,
			authorLogin: c.author?.login ?? null,
			authorEmail: null,
			authoredAt: c.commit.author?.date ?? "",
		}));
	}

	async readFile(
		repoFullName: string,
		path: string,
		ref: string,
	): Promise<string | null> {
		try {
			const data = (await this.get(
				repoFullName,
				`/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(ref)}`,
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
		const user = (await this.get(repoFullName, `/users/${login}`)) as {
			id: number;
			created_at: string;
			followers: number;
			following: number;
			public_repos: number;
			bio: string | null;
		};
		const [merged, mergedElsewhere, recent, permission, profileReadme] =
			await Promise.all([
				this.get(
					repoFullName,
					`/search/issues?q=${encodeURIComponent(
						`repo:${repoFullName} author:${login} is:pr is:merged`,
					)}&per_page=1`,
				).catch(() => null) as Promise<{ total_count: number } | null>,
				// GLOBAL merged CRs, EXCLUDING repos the contributor owns (`-user:X`),
				// so a self-created + self-merged PR can't manufacture reputation
				// (min-merged-prs@2). null on failure ⇒ the rule skips, never guesses.
				this.get(
					repoFullName,
					`/search/issues?q=${encodeURIComponent(
						`author:${login} is:pr is:merged -user:${login}`,
					)}&per_page=1`,
				).catch(() => null) as Promise<{ total_count: number } | null>,
				this.get(
					repoFullName,
					`/search/issues?q=${encodeURIComponent(
						`author:${login} is:pr created:>=${recentWindowIso()}`,
					)}&per_page=100`,
				).catch(() => null) as Promise<{
					items: { created_at: string }[];
				} | null>,
				this.get(
					repoFullName,
					`/repos/${repoFullName}/collaborators/${login}/permission`,
				).catch(() => null) as Promise<{ permission: string } | null>,
				this.readFile(`${login}/${login}`, "README.md", "HEAD").catch(
					() => null,
				),
			]);
		const perm = permission?.permission ?? "none";
		return {
			login,
			externalId: String(user.id),
			createdAt: user.created_at,
			followers: user.followers,
			following: user.following,
			publicRepos: user.public_repos,
			profileText: profileReadme ?? user.bio,
			mergedInRepo: merged?.total_count ?? 0,
			// null (not 0) on a failed read — 0 would falsely read as "no reputation".
			mergedElsewhere: mergedElsewhere ? mergedElsewhere.total_count : null,
			recentChangeRequestTimes: (recent?.items ?? []).map((i) => i.created_at),
			isOrgMember: perm === "admin" || perm === "maintain" || perm === "write",
			isMaintainer: perm === "admin" || perm === "maintain" || perm === "write",
		};
	}
}

function recentWindowIso(): string {
	const dayMs = 86_400_000;
	return new Date(Date.now() - 7 * dayMs).toISOString().slice(0, 10);
}
