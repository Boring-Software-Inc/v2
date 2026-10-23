import type {
	ForgeThread,
	ThreadListQuery,
	ThreadListResult,
} from "@tripwire/forge";
import { type GithubHttp, GithubHttpError } from "./http.ts";

const MAX_PAGES = 30;

interface GithubIssue {
	number: number;
	title: string;
	html_url: string;
	state: "open" | "closed";
	locked: boolean;
	updated_at: string;
	user: { login: string; id: number; avatar_url?: string } | null;
	labels: ({ name?: string } | string)[];
	pull_request?: unknown;
}

function labelNames(issue: GithubIssue): string[] {
	return issue.labels.flatMap((label) =>
		typeof label === "string" ? [label] : label.name ? [label.name] : [],
	);
}

function firstPath(repoFullName: string, query: ThreadListQuery): string {
	const params = new URLSearchParams({
		state: query.state === "any" ? "all" : query.state,
		sort: "updated",
		direction: "asc",
		per_page: "100",
	});
	if (query.labels.length > 0) {
		params.set("labels", query.labels.join(","));
	}
	return `/repos/${repoFullName}/issues?${params.toString()}`;
}

function toThread(issue: GithubIssue): ForgeThread {
	return {
		kind: issue.pull_request ? "change-request" : "issue",
		number: issue.number,
		title: issue.title,
		url: issue.html_url,
		state: issue.state,
		author: issue.user?.login ?? "ghost",
		authorExternalId: String(issue.user?.id ?? 0),
		authorAvatarUrl: issue.user?.avatar_url,
		labels: labelNames(issue),
		locked: issue.locked,
		updatedAt: new Date(issue.updated_at).toISOString(),
	};
}

export async function listThreads(
	http: GithubHttp,
	repoFullName: string,
	query: ThreadListQuery,
): Promise<ThreadListResult> {
	const excluded = new Set(
		query.excludeLabels.map((label) => label.toLowerCase()),
	);
	const cutoff = query.updatedBefore ? Date.parse(query.updatedBefore) : null;
	const threads: ForgeThread[] = [];
	let path: string | null = firstPath(repoFullName, query);
	for (let page = 0; path && page < MAX_PAGES; page++) {
		let body: unknown;
		try {
			({ body, next: path } = await http.getPage(repoFullName, path));
		} catch (error) {
			if (error instanceof GithubHttpError && error.rateLimited) {
				return { threads, stopped: "rate-limit" };
			}
			throw error;
		}
		for (const issue of body as GithubIssue[]) {
			if (cutoff !== null && Date.parse(issue.updated_at) >= cutoff) {
				return { threads, stopped: null };
			}
			const thread = toThread(issue);
			if (
				!query.subjects.includes(thread.kind) ||
				(query.skipLocked && thread.locked) ||
				thread.labels.some((label) => excluded.has(label.toLowerCase()))
			) {
				continue;
			}
			threads.push(thread);
			if (threads.length >= query.cap) {
				return { threads, stopped: null };
			}
		}
	}
	return { threads, stopped: null };
}
