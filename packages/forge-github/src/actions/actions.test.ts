import { describe, expect, test } from "bun:test";
import {
	CHECK_NAME,
	COMMENT_MARKER,
	REVIEW_POINTER,
	renderCommentBody,
} from "@tripwire/contracts";
import { GithubHttp } from "../client/http.ts";
import { supersededBody } from "../copy.ts";
import { setCheck } from "./check.ts";
import { upsertComment } from "./comment.ts";

/**
 * Fake-fetch upsert semantics: one comment per thread, one check per SHA, edits
 * never appends. The renderCommentBody snapshot layer moved to
 * `@tripwire/contracts` (comment-render.test.ts) with the render function.
 */

const APP_ID = 4291944;

function ours(id: number, body: string) {
	return { id, body, performed_via_github_app: { id: APP_ID } };
}

interface RecordedCall {
	method: string;
	path: string;
	body: unknown;
}

function fakeHttp(responses: Record<string, unknown>) {
	const calls: RecordedCall[] = [];
	const http = new GithubHttp({
		tokenFor: () => Promise.resolve("test-token"),
		appId: APP_ID,
		apiBase: "https://fake.api",
		fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
			const path = String(url).replace("https://fake.api", "");
			const key = `${init?.method ?? "GET"} ${path}`;
			calls.push({
				method: init?.method ?? "GET",
				path,
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			const match = Object.entries(responses).find(([pattern]) =>
				key.startsWith(pattern),
			);
			return Promise.resolve(
				new Response(JSON.stringify(match?.[1] ?? {}), { status: 200 }),
			);
		}) as typeof fetch,
	});
	return { http, calls };
}

const COMMON = {
	contributorLogin: "octocat",
	runUrl: "https://tripwire.sh/runs/x",
};
const BLOCK_COMMENT = renderCommentBody({
	verdict: "block",
	reasons: [
		{
			text: "Your account is 2 days old.",
			remedy: "wait",
			ruleName: "Account age",
		},
	],
	...COMMON,
});
const PASS_COMMENT = renderCommentBody({
	verdict: "pass",
	reasons: [],
	...COMMON,
});

describe("upsertComment — verdict-aware lifecycle (§7)", () => {
	test("creates when no tripwire comment exists", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [{ id: 1, body: "unrelated" }],
			"POST /repos/a/b/issues/7/comments": { id: 42 },
		});
		// First-time verdict — run history has no previous verdict.
		const result = await upsertComment(
			http,
			"a/b",
			7,
			BLOCK_COMMENT,
			"block",
			null,
		);
		expect(result).toEqual({
			externalId: "42",
			created: true,
			supersededId: null,
		});
		expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
	});

	test("SAME verdict edits in place — never a new comment", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [ours(9, BLOCK_COMMENT)],
		});
		const result = await upsertComment(
			http,
			"a/b",
			7,
			BLOCK_COMMENT,
			"block",
			"block",
		);
		expect(result).toEqual({
			externalId: "9",
			created: false,
			supersededId: null,
		});
		expect(calls.some((c) => c.method === "POST")).toBe(false);
		expect(calls.find((c) => c.method === "PATCH")?.path).toBe(
			"/repos/a/b/issues/comments/9",
		);
	});

	test("ten same-verdict re-runs = ONE comment (ten edits, zero posts)", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [ours(9, BLOCK_COMMENT)],
		});
		for (let i = 0; i < 10; i++) {
			await upsertComment(http, "a/b", 7, BLOCK_COMMENT, "block", "block");
		}
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
		expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(10);
	});

	test("a VERDICT TRANSITION supersedes the old comment AND posts a new one", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [ours(9, BLOCK_COMMENT)],
			"POST /repos/a/b/issues/7/comments": { id: 50 },
		});
		// Run history says the PR shows "block" → this is a transition.
		const result = await upsertComment(
			http,
			"a/b",
			7,
			PASS_COMMENT,
			"pass",
			"block",
		);
		expect(result).toEqual({
			externalId: "50",
			created: true,
			supersededId: "9",
		});
		// the old comment is struck + points forward, and loses its marker.
		const patch = calls.find((c) => c.method === "PATCH");
		expect(patch?.path).toBe("/repos/a/b/issues/comments/9");
		const patchedBody = (patch?.body as { body: string }).body;
		expect(patchedBody).toContain(
			"This result is out of date. See the newer comment below.",
		);
		expect(patchedBody).not.toContain(COMMENT_MARKER);
		// a genuinely new comment is posted, chronologically last.
		expect(calls.find((c) => c.method === "POST")?.path).toBe(
			"/repos/a/b/issues/7/comments",
		);
	});

	test("a transition whose old comment was DELETED still posts — no supersede, no crash", async () => {
		const { http, calls } = fakeHttp({
			// The tripwire comment is gone (a human deleted it); no marker in the thread.
			"GET /repos/a/b/issues/7/comments": [{ id: 1, body: "unrelated" }],
			"POST /repos/a/b/issues/7/comments": { id: 60 },
		});
		// Run history KNOWS this is blocked→passed — never a "first verdict".
		const result = await upsertComment(
			http,
			"a/b",
			7,
			PASS_COMMENT,
			"pass",
			"block",
		);
		expect(result).toEqual({
			externalId: "60",
			created: true,
			supersededId: null,
		});
		// Nothing to supersede — a resolution comment posts, no PATCH, no duplicate.
		expect(calls.some((c) => c.method === "PATCH")).toBe(false);
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
	});

	test("only-if-present skips a change request with no Tripwire comment", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [{ id: 1, body: "unrelated" }],
		});
		const result = await upsertComment(
			http,
			"a/b",
			7,
			PASS_COMMENT,
			"pass",
			"block",
			true,
		);
		expect(result).toEqual({
			externalId: null,
			created: false,
			supersededId: null,
		});
		expect(calls.map((c) => c.method)).toEqual(["GET"]);
	});

	test("only-if-present still updates a comment that is there", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [ours(5, BLOCK_COMMENT)],
			"POST /repos/a/b/issues/7/comments": { id: 61 },
		});
		const result = await upsertComment(
			http,
			"a/b",
			7,
			PASS_COMMENT,
			"pass",
			"block",
			true,
		);
		expect(result).toMatchObject({ externalId: "61" });
		expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH", "POST"]);
	});

	test("superseded body — struck, marker-less, points forward", () => {
		expect(supersededBody(BLOCK_COMMENT)).toMatchSnapshot();
	});

	test("superseded list: every reason struck, the run link dropped", () => {
		const body = renderCommentBody({
			verdict: "block",
			reasons: [
				{
					text: "Your account is 2 days old.",
					remedy: "wait",
					ruleName: "Account age",
				},
				{
					text: "It changes 40 files.",
					remedy: "revise",
					ruleName: "Max files changed",
				},
			],
			...COMMON,
		});
		expect(supersededBody(body)).toBe(
			[
				"~~@octocat, Tripwire blocked this change request.~~",
				"",
				"- ~~**Account age:** Your account is 2 days old.~~",
				"- ~~**Max files changed:** It changes 40 files.~~",
				"",
				"This result is out of date. See the newer comment below.",
			].join("\n"),
		);
	});
});

describe("setCheck", () => {
	const state = {
		sha: "a".repeat(40),
		conclusion: "failure" as const,
		summary: "Blocked. Your account is 2 days old.",
		detailsUrl: "https://tripwire.sh/runs/x",
	};

	test("creates a completed check when none exists for the SHA", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: { check_runs: [] },
			"POST /repos/a/b/check-runs": { id: 77 },
		});
		const result = await setCheck(http, "a/b", state);
		expect(result).toEqual({ externalId: "77", created: true });
		const post = calls.find((c) => c.method === "POST");
		expect(post?.body).toMatchObject({
			name: CHECK_NAME,
			head_sha: state.sha,
			status: "completed",
			conclusion: "failure",
			details_url: state.detailsUrl,
			output: { title: "Blocked", summary: state.summary },
		});
	});

	test("re-run of the same SHA updates the existing check", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 55, status: "completed", app: { id: APP_ID } }],
			},
		});
		const result = await setCheck(http, "a/b", state);
		expect(result).toEqual({ externalId: "55", created: false });
		expect(calls.find((c) => c.method === "PATCH")?.path).toBe(
			"/repos/a/b/check-runs/55",
		);
	});

	test("a pending state after a completed check starts a new check", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 55, status: "completed", app: { id: APP_ID } }],
			},
			"POST /repos/a/b/check-runs": { id: 79 },
		});
		const result = await setCheck(http, "a/b", {
			...state,
			conclusion: "pending",
			summary: "Waiting for human review.",
		});
		expect(result).toEqual({ externalId: "79", created: true });
		expect(calls.some((c) => c.method === "PATCH")).toBe(false);
		expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
			head_sha: state.sha,
			status: "in_progress",
		});
	});

	test("a pending state updates a check that is still in progress", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 56, status: "in_progress", app: { id: APP_ID } }],
			},
		});
		const result = await setCheck(http, "a/b", {
			...state,
			conclusion: "pending",
		});
		expect(result).toEqual({ externalId: "56", created: false });
		expect(calls.some((c) => c.method === "POST")).toBe(false);
	});

	test("a queued check counts as not completed", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 57, status: "queued", app: { id: APP_ID } }],
			},
		});
		await setCheck(http, "a/b", { ...state, conclusion: "pending" });
		expect(calls.find((c) => c.method === "PATCH")?.path).toBe(
			"/repos/a/b/check-runs/57",
		);
	});

	test("a decision completes the check that waits for it", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 58, status: "in_progress", app: { id: APP_ID } }],
			},
		});
		await setCheck(http, "a/b", { ...state, conclusion: "success" });
		const patch = calls.find((c) => c.method === "PATCH");
		expect(patch?.path).toBe("/repos/a/b/check-runs/58");
		expect(patch?.body).toMatchObject({
			status: "completed",
			conclusion: "success",
		});
	});

	test("a new conclusion replaces a completed one on the same check", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 59, status: "completed", app: { id: APP_ID } }],
			},
		});
		await setCheck(http, "a/b", { ...state, conclusion: "success" });
		expect(calls.some((c) => c.method === "POST")).toBe(false);
		expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
			status: "completed",
			conclusion: "success",
		});
	});

	test("writes to the newest own check when the SHA has several", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [
					{ id: 55, status: "completed", app: { id: APP_ID } },
					{ id: 90, status: "in_progress", app: { id: APP_ID } },
					{ id: 120, status: "in_progress", app: { id: 1 } },
				],
			},
		});
		const result = await setCheck(http, "a/b", {
			...state,
			conclusion: "success",
		});
		expect(result).toEqual({ externalId: "90", created: false });
		expect(calls.find((c) => c.method === "PATCH")?.path).toBe(
			"/repos/a/b/check-runs/90",
		);
	});

	test("lists every own check on the SHA, not only the latest", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: { check_runs: [] },
			"POST /repos/a/b/check-runs": { id: 91 },
		});
		await setCheck(http, "a/b", state);
		const query = new URL(`https://x${calls[0]?.path}`).searchParams;
		expect(query.get("filter")).toBe("all");
		expect(query.get("per_page")).toBe("100");
	});

	test("pending maps to in_progress with no conclusion (§5.6b)", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: { check_runs: [] },
			"POST /repos/a/b/check-runs": { id: 78 },
		});
		await setCheck(http, "a/b", { ...state, conclusion: "pending" });
		const post = calls.find((c) => c.method === "POST");
		expect(post?.body).toMatchObject({ status: "in_progress" });
		expect((post?.body as Record<string, unknown>).conclusion).toBeUndefined();
	});
});

describe("executeAction — block files a request-changes review", () => {
	test("posts REQUEST_CHANGES with the one-line review body", async () => {
		const { http, calls } = fakeHttp({
			"POST /repos/a/b/pulls/7/reviews": { id: 91 },
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "block",
			repoFullName: "a/b",
			number: 7,
			reason: REVIEW_POINTER.block,
		});
		expect(result).toMatchObject({ externalId: "91" });
		const post = calls.find((c) => c.method === "POST");
		expect(post?.path).toBe("/repos/a/b/pulls/7/reviews");
		expect(post?.body).toEqual({
			event: "REQUEST_CHANGES",
			body: REVIEW_POINTER.block,
		});
	});
});

describe("executeAction: update-review edits the live review, never stacks", () => {
	const update = {
		kind: "update-review" as const,
		repoFullName: "a/b",
		number: 7,
		reviewId: "91",
		reason: REVIEW_POINTER.block,
	};

	test("edits the body of a live request-changes review in place", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/pulls/7/reviews/91": {
				id: 91,
				state: "CHANGES_REQUESTED",
				body: "Tripwire blocked this. Your account is 2 days old.",
			},
			"PUT /repos/a/b/pulls/7/reviews/91": { id: 91 },
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, update);
		expect(result).toMatchObject({ externalId: "91" });
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /repos/a/b/pulls/7/reviews/91",
			"PUT /repos/a/b/pulls/7/reviews/91",
		]);
		expect(calls[1]?.body).toEqual({ body: REVIEW_POINTER.block });
	});

	test("an unchanged body makes no write at all", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/pulls/7/reviews/91": {
				id: 91,
				state: "CHANGES_REQUESTED",
				body: REVIEW_POINTER.block,
			},
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, update);
		expect(result).toMatchObject({ externalId: "91" });
		expect(calls.map((c) => c.method)).toEqual(["GET"]);
	});

	test("a review dismissed on GitHub gets a fresh one", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/pulls/7/reviews/91": { id: 91, state: "DISMISSED" },
			"POST /repos/a/b/pulls/7/reviews": { id: 92 },
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, update);
		expect(result).toMatchObject({ externalId: "92" });
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			event: "REQUEST_CHANGES",
			body: REVIEW_POINTER.block,
		});
		expect(calls.some((c) => c.method === "PUT")).toBe(false);
	});

	function statusHttp(status: number) {
		const calls: string[] = [];
		const http = new GithubHttp({
			tokenFor: () => Promise.resolve("test-token"),
			appId: APP_ID,
			apiBase: "https://fake.api",
			fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
				const method = init?.method ?? "GET";
				calls.push(method);
				return Promise.resolve(
					method === "GET"
						? new Response(JSON.stringify({ message: "x" }), { status })
						: new Response(JSON.stringify({ id: 93 }), { status: 200 }),
				);
			}) as typeof fetch,
		});
		return { http, calls };
	}

	test("a deleted review gets a fresh one", async () => {
		const { http, calls } = statusHttp(404);
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, update);
		expect(result).toMatchObject({ externalId: "93" });
		expect(calls).toEqual(["GET", "POST"]);
	});

	test("any other read failure throws instead of stacking a second review", async () => {
		const { http, calls } = statusHttp(502);
		const { executeAction } = await import("./execute.ts");
		await expect(executeAction(http, update)).rejects.toThrow(/502/);
		expect(calls).toEqual(["GET"]);
	});
});

describe("executeAction — dismiss-review clears a stale request-changes", () => {
	test("PUTs a dismissal for the stored review id", async () => {
		const { http, calls } = fakeHttp({
			"PUT /repos/a/b/pulls/7/reviews/91/dismissals": {},
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "dismiss-review",
			repoFullName: "a/b",
			number: 7,
			reviewId: "91",
		});
		expect(result).toMatchObject({ externalId: "91" });
		const put = calls.find((c) => c.method === "PUT");
		expect(put?.path).toBe("/repos/a/b/pulls/7/reviews/91/dismissals");
		expect(put?.body).toMatchObject({ event: "DISMISS" });
	});
});

describe("executeAction: delete-comment removes the active comment", () => {
	test("deletes the comment that carries the marker", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [
				ours(4, BLOCK_COMMENT),
				{ id: 5, body: "unrelated" },
			],
			"DELETE /repos/a/b/issues/comments/4": {},
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "delete-comment",
			repoFullName: "a/b",
			number: 7,
		});
		expect(result).toMatchObject({ externalId: "4" });
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /repos/a/b/issues/7/comments?per_page=100",
			"DELETE /repos/a/b/issues/comments/4",
		]);
	});

	test("no Tripwire comment: nothing to delete", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [{ id: 5, body: "unrelated" }],
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "delete-comment",
			repoFullName: "a/b",
			number: 7,
		});
		expect(result).toMatchObject({ externalId: null });
		expect(calls.map((c) => c.method)).toEqual(["GET"]);
	});

	test("a comment deleted in the meantime is not an error", async () => {
		const http = new GithubHttp({
			tokenFor: () => Promise.resolve("t"),
			appId: APP_ID,
			apiBase: "https://fake.api",
			fetchImpl: ((_url: string | URL | Request, init?: RequestInit) =>
				Promise.resolve(
					init?.method === "DELETE"
						? new Response("Not Found", { status: 404 })
						: new Response(JSON.stringify([ours(4, BLOCK_COMMENT)]), {
								status: 200,
							}),
				)) as typeof fetch,
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "delete-comment",
			repoFullName: "a/b",
			number: 7,
		});
		expect(result).toMatchObject({ externalId: null });
	});
});

describe("executeAction — request-review asks named people and teams", () => {
	test("POSTs reviewers and team_reviewers to requested_reviewers", async () => {
		const { http, calls } = fakeHttp({
			"POST /repos/a/b/pulls/7/requested_reviewers": { number: 7 },
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "request-review",
			repoFullName: "a/b",
			number: 7,
			reviewers: ["octocat", "hubot"],
			teamReviewers: ["core"],
		});
		expect(result).toMatchObject({ externalId: null });
		expect(calls).toEqual([
			{
				method: "POST",
				path: "/repos/a/b/pulls/7/requested_reviewers",
				body: { reviewers: ["octocat", "hubot"], team_reviewers: ["core"] },
			},
		]);
	});

	test("refuses an action with no targets and reaches no endpoint", async () => {
		const { http, calls } = fakeHttp({});
		const { executeAction } = await import("./execute.ts");
		await expect(
			executeAction(http, {
				kind: "request-review",
				repoFullName: "a/b",
				number: 7,
				reviewers: [],
				teamReviewers: [],
			}),
		).rejects.toThrow(/no people or teams/);
		expect(calls).toHaveLength(0);
	});

	test("a GitHub refusal surfaces as an error carrying the status", async () => {
		const http = new GithubHttp({
			tokenFor: () => Promise.resolve("test-token"),
			appId: APP_ID,
			apiBase: "https://fake.api",
			fetchImpl: ((_url: string | URL | Request, _init?: RequestInit) =>
				Promise.resolve(
					new Response(JSON.stringify({ message: "Validation Failed" }), {
						status: 422,
					}),
				)) as typeof fetch,
		});
		const { executeAction } = await import("./execute.ts");
		await expect(
			executeAction(http, {
				kind: "request-review",
				repoFullName: "a/b",
				number: 7,
				reviewers: ["not-a-collaborator"],
				teamReviewers: [],
			}),
		).rejects.toThrow(/requested_reviewers failed: 422/);
	});
});

describe("executeAction: lock and close use the issues API", () => {
	test("lock sends the reason as lock_reason", async () => {
		const { http, calls } = fakeHttp({});
		const { executeAction } = await import("./execute.ts");
		await executeAction(http, {
			kind: "lock",
			repoFullName: "a/b",
			number: 9,
			reason: "too heated",
		});
		expect(calls).toEqual([
			{
				method: "PUT",
				path: "/repos/a/b/issues/9/lock",
				body: { lock_reason: "too heated" },
			},
		]);
	});

	test("lock without a reason sends an empty body", async () => {
		const { http, calls } = fakeHttp({});
		const { executeAction } = await import("./execute.ts");
		await executeAction(http, { kind: "lock", repoFullName: "a/b", number: 9 });
		expect(calls[0]).toEqual({
			method: "PUT",
			path: "/repos/a/b/issues/9/lock",
			body: {},
		});
	});

	test("close patches the state", async () => {
		const { http, calls } = fakeHttp({});
		const { executeAction } = await import("./execute.ts");
		await executeAction(http, {
			kind: "close",
			repoFullName: "a/b",
			number: 9,
		});
		expect(calls).toEqual([
			{
				method: "PATCH",
				path: "/repos/a/b/issues/9",
				body: { state: "closed" },
			},
		]);
	});
});

describe("only objects this app created are ever touched", () => {
	const spoofed = {
		id: 3,
		body: BLOCK_COMMENT,
		user: { login: "mallory", type: "User" },
		performed_via_github_app: null,
	};
	const otherApp = {
		id: 8,
		body: BLOCK_COMMENT,
		user: { login: "copycat[bot]", type: "Bot" },
		performed_via_github_app: { id: 1, slug: "copycat" },
	};

	test("a contributor comment carrying the marker is never edited", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [spoofed],
			"POST /repos/a/b/issues/7/comments": { id: 70 },
		});
		const result = await upsertComment(
			http,
			"a/b",
			7,
			BLOCK_COMMENT,
			"block",
			"block",
		);
		expect(result).toMatchObject({ externalId: "70" });
		expect(calls.some((c) => c.method === "PATCH")).toBe(false);
	});

	test("another app's bot comment carrying the marker is never superseded", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [otherApp],
			"POST /repos/a/b/issues/7/comments": { id: 71 },
		});
		const result = await upsertComment(
			http,
			"a/b",
			7,
			PASS_COMMENT,
			"pass",
			"block",
		);
		expect(result).toEqual({
			externalId: "71",
			created: true,
			supersededId: null,
		});
		expect(calls.some((c) => c.method === "PATCH")).toBe(false);
	});

	test("our own comment is found behind a newer spoofed one", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [
				ours(2, BLOCK_COMMENT),
				spoofed,
				otherApp,
			],
		});
		await upsertComment(http, "a/b", 7, BLOCK_COMMENT, "block", "block");
		expect(calls.find((c) => c.method === "PATCH")?.path).toBe(
			"/repos/a/b/issues/comments/2",
		);
	});

	test("delete-comment never deletes a spoofed or foreign comment", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [spoofed, otherApp],
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "delete-comment",
			repoFullName: "a/b",
			number: 7,
		});
		expect(result).toMatchObject({ externalId: null });
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);
	});

	test("setCheck lists only this app's check runs", async () => {
		const sha = "b".repeat(40);
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${sha}/check-runs`]: { check_runs: [] },
			"POST /repos/a/b/check-runs": { id: 80 },
		});
		await setCheck(http, "a/b", {
			sha,
			conclusion: "success",
			summary: "Passed.",
			detailsUrl: "https://tripwire.sh/runs/x",
		});
		const query = new URL(`https://x${calls[0]?.path}`).searchParams;
		expect(query.get("app_id")).toBe(String(APP_ID));
		expect(query.get("check_name")).toBe(CHECK_NAME);
	});

	test("setCheck never patches another app's check named tripwire", async () => {
		const sha = "c".repeat(40);
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${sha}/check-runs`]: {
				check_runs: [{ id: 66, status: "completed", app: { id: 1 } }],
			},
			"POST /repos/a/b/check-runs": { id: 81 },
		});
		const result = await setCheck(http, "a/b", {
			sha,
			conclusion: "failure",
			summary: "Blocked.",
			detailsUrl: "https://tripwire.sh/runs/x",
		});
		expect(result).toEqual({ externalId: "81", created: true });
		expect(calls.some((c) => c.method === "PATCH")).toBe(false);
	});
});
