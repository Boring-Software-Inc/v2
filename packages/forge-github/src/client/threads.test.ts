import { describe, expect, test } from "bun:test";
import type { ThreadListQuery } from "@tripwire/forge";
import issueComment from "../../fixtures/issue_comment.created.json";
import pullRequestOpened from "../../fixtures/pull_request.opened.json";
import { GithubHttp } from "./http.ts";
import { listThreads } from "./threads.ts";

const API = "https://fake.api";
const ISSUE = issueComment.issue;
const PR = pullRequestOpened.pull_request;

function issue(
	number: number,
	updatedAt: string,
	extra: Record<string, unknown> = {},
) {
	return {
		...ISSUE,
		number,
		html_url: `https://github.com/Codertocat/Hello-World/issues/${number}`,
		updated_at: updatedAt,
		...extra,
	};
}

function pull(number: number, updatedAt: string) {
	return issue(number, updatedAt, {
		html_url: `https://github.com/Codertocat/Hello-World/pull/${number}`,
		pull_request: {
			url: PR.url.replace(/\/2$/, `/${number}`),
			html_url: PR.html_url.replace(/\/2$/, `/${number}`),
			diff_url: PR.diff_url.replace("/2.diff", `/${number}.diff`),
			patch_url: PR.patch_url.replace("/2.patch", `/${number}.patch`),
			merged_at: null,
		},
	});
}

interface Page {
	status?: number;
	headers?: Record<string, string>;
	body: unknown;
}

function fakeHttp(pages: Page[]) {
	const paths: string[] = [];
	const http = new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		apiBase: API,
		fetchImpl: ((url: string | URL | Request) => {
			paths.push(String(url).replace(API, ""));
			const page = pages[paths.length - 1] ?? { body: [] };
			return Promise.resolve(
				new Response(JSON.stringify(page.body), {
					status: page.status ?? 200,
					headers: page.headers ?? {},
				}),
			);
		}) as typeof fetch,
	});
	return { http, paths };
}

function nextLinkTo(page: number) {
	return {
		link: `<${API}/repositories/186853002/issues?state=all&sort=updated&direction=asc&per_page=100&page=${page}>; rel="next", <${API}/repositories/186853002/issues?page=9>; rel="last"`,
	};
}

const QUERY: ThreadListQuery = {
	subjects: ["issue", "change-request"],
	state: "any",
	updatedBefore: "2026-01-01T00:00:00.000Z",
	labels: [],
	excludeLabels: [],
	skipLocked: true,
	cap: 100,
};

describe("listThreads", () => {
	test("asks for the oldest activity first with state and labels", async () => {
		const { http, paths } = fakeHttp([{ body: [] }]);
		await listThreads(http, "Codertocat/Hello-World", {
			...QUERY,
			state: "closed",
			labels: ["bug", "needs info"],
		});
		const url = new URL(`${API}${paths[0]}`);
		expect(url.pathname).toBe("/repos/Codertocat/Hello-World/issues");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			state: "closed",
			sort: "updated",
			direction: "asc",
			per_page: "100",
			labels: "bug,needs info",
		});
	});

	test("any maps to all", async () => {
		const { http, paths } = fakeHttp([{ body: [] }]);
		await listThreads(http, "Codertocat/Hello-World", QUERY);
		expect(paths[0]).toContain("state=all");
	});

	test("tells issues from pull requests and maps the fields", async () => {
		const { http } = fakeHttp([
			{
				body: [
					issue(1, "2025-03-01T00:00:00Z"),
					pull(2, "2025-04-01T00:00:00Z"),
				],
			},
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", QUERY);
		expect(result.stopped).toBeNull();
		expect(result.threads).toEqual([
			{
				kind: "issue",
				number: 1,
				title: ISSUE.title,
				url: "https://github.com/Codertocat/Hello-World/issues/1",
				state: "open",
				author: "Codertocat",
				authorExternalId: "21031067",
				authorAvatarUrl: ISSUE.user.avatar_url,
				labels: ["bug"],
				locked: false,
				updatedAt: "2025-03-01T00:00:00.000Z",
			},
			expect.objectContaining({
				kind: "change-request",
				number: 2,
				url: "https://github.com/Codertocat/Hello-World/pull/2",
			}),
		]);
	});

	test("follows the Link header and stops at the inactivity cutoff", async () => {
		const { http, paths } = fakeHttp([
			{
				headers: nextLinkTo(2),
				body: [
					issue(1, "2025-01-01T00:00:00Z"),
					issue(2, "2025-02-01T00:00:00Z"),
				],
			},
			{
				headers: nextLinkTo(3),
				body: [
					issue(3, "2025-12-31T00:00:00Z"),
					issue(4, "2026-02-01T00:00:00Z"),
				],
			},
			{ body: [issue(5, "2026-03-01T00:00:00Z")] },
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", QUERY);
		expect(result.threads.map((thread) => thread.number)).toEqual([1, 2, 3]);
		expect(paths).toHaveLength(2);
		expect(paths[1]).toBe(
			"/repositories/186853002/issues?state=all&sort=updated&direction=asc&per_page=100&page=2",
		);
	});

	test("without a cutoff it reads until the last page", async () => {
		const { http, paths } = fakeHttp([
			{ headers: nextLinkTo(2), body: [issue(1, "2025-01-01T00:00:00Z")] },
			{ body: [issue(2, "2027-01-01T00:00:00Z")] },
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", {
			...QUERY,
			updatedBefore: null,
		});
		expect(result.threads.map((thread) => thread.number)).toEqual([1, 2]);
		expect(paths).toHaveLength(2);
	});

	test("stops at the cap", async () => {
		const many = Array.from({ length: 100 }, (_, index) =>
			issue(index + 1, "2025-01-01T00:00:00Z"),
		);
		const { http, paths } = fakeHttp([
			{ headers: nextLinkTo(2), body: many },
			{ body: [issue(101, "2025-01-02T00:00:00Z")] },
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", {
			...QUERY,
			cap: 3,
		});
		expect(result.threads.map((thread) => thread.number)).toEqual([1, 2, 3]);
		expect(paths).toHaveLength(1);
	});

	test("filters subjects, excluded labels and locked threads", async () => {
		const { http } = fakeHttp([
			{
				body: [
					issue(1, "2025-01-01T00:00:00Z"),
					issue(2, "2025-01-01T00:00:00Z", {
						labels: [{ ...ISSUE.labels[0], name: "Pinned" }],
					}),
					issue(3, "2025-01-01T00:00:00Z", { locked: true }),
					pull(4, "2025-01-01T00:00:00Z"),
				],
			},
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", {
			...QUERY,
			subjects: ["issue"],
			excludeLabels: ["pinned"],
		});
		expect(result.threads.map((thread) => thread.number)).toEqual([1]);
	});

	test("keeps locked threads when skipLocked is off", async () => {
		const { http } = fakeHttp([
			{ body: [issue(3, "2025-01-01T00:00:00Z", { locked: true })] },
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", {
			...QUERY,
			skipLocked: false,
		});
		expect(result.threads.map((thread) => thread.locked)).toEqual([true]);
	});

	test("a rate limit stops the listing and keeps what was read", async () => {
		const { http } = fakeHttp([
			{ headers: nextLinkTo(2), body: [issue(1, "2025-01-01T00:00:00Z")] },
			{
				status: 403,
				headers: { "x-ratelimit-remaining": "0" },
				body: {
					message: "API rate limit exceeded for installation ID 1.",
					documentation_url:
						"https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
				},
			},
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", QUERY);
		expect(result).toEqual({
			threads: [expect.objectContaining({ number: 1 })],
			stopped: "rate-limit",
		});
	});

	test("a secondary limit 429 also stops", async () => {
		const { http } = fakeHttp([
			{ status: 429, headers: { "retry-after": "60" }, body: {} },
		]);
		const result = await listThreads(http, "Codertocat/Hello-World", QUERY);
		expect(result).toEqual({ threads: [], stopped: "rate-limit" });
	});

	test("other failures throw", async () => {
		const { http } = fakeHttp([
			{ status: 404, body: { message: "Not Found" } },
		]);
		await expect(
			listThreads(http, "Codertocat/Hello-World", QUERY),
		).rejects.toThrow(/failed: 404/);
	});
});
