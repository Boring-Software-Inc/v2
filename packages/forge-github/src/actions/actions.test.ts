import { describe, expect, test } from "bun:test";
import {
	CHECK_NAME,
	COMMENT_MARKER,
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

interface RecordedCall {
	method: string;
	path: string;
	body: unknown;
}

function fakeHttp(responses: Record<string, unknown>) {
	const calls: RecordedCall[] = [];
	const http = new GithubHttp({
		tokenFor: () => Promise.resolve("test-token"),
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
	badgeUrl: "https://tripwire.sh/badges/view-run.png",
};
const BLOCK_COMMENT = renderCommentBody({
	verdict: "block",
	reasons: [{ text: "your account is 2 days old", remedy: "wait" }],
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
			"GET /repos/a/b/issues/7/comments": [{ id: 9, body: BLOCK_COMMENT }],
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
			"GET /repos/a/b/issues/7/comments": [{ id: 9, body: BLOCK_COMMENT }],
		});
		for (let i = 0; i < 10; i++) {
			await upsertComment(http, "a/b", 7, BLOCK_COMMENT, "block", "block");
		}
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
		expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(10);
	});

	test("a VERDICT TRANSITION supersedes the old comment AND posts a new one", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [{ id: 9, body: BLOCK_COMMENT }],
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
		expect(patchedBody).toContain("superseded — see the newer check below.");
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

	test("superseded body — struck, marker-less, points forward", () => {
		expect(supersededBody(BLOCK_COMMENT)).toMatchSnapshot();
	});
});

describe("setCheck", () => {
	const state = {
		sha: "a".repeat(40),
		conclusion: "failure" as const,
		summary: "blocked — your account is 2 days old",
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
		});
	});

	test("re-run of the same SHA updates the existing check", async () => {
		const { http, calls } = fakeHttp({
			[`GET /repos/a/b/commits/${state.sha}/check-runs`]: {
				check_runs: [{ id: 55 }],
			},
		});
		const result = await setCheck(http, "a/b", state);
		expect(result).toEqual({ externalId: "55", created: false });
		expect(calls.find((c) => c.method === "PATCH")?.path).toBe(
			"/repos/a/b/check-runs/55",
		);
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
	test("posts REQUEST_CHANGES with the constitution one-liner", async () => {
		const { http, calls } = fakeHttp({
			"POST /repos/a/b/pulls/7/reviews": { id: 91 },
		});
		const { executeAction } = await import("./execute.ts");
		const result = await executeAction(http, {
			kind: "block",
			repoFullName: "a/b",
			number: 7,
			reason: "blocked — your account is 2 days old.",
		});
		expect(result.externalId).toBe("91");
		const post = calls.find((c) => c.method === "POST");
		expect(post?.path).toBe("/repos/a/b/pulls/7/reviews");
		expect(post?.body).toMatchObject({ event: "REQUEST_CHANGES" });
		expect(String((post?.body as { body: string }).body)).toContain(
			"blocked — your account is 2 days old.",
		);
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
		expect(result.externalId).toBe("91");
		const put = calls.find((c) => c.method === "PUT");
		expect(put?.path).toBe("/repos/a/b/pulls/7/reviews/91/dismissals");
		expect(put?.body).toMatchObject({ event: "DISMISS" });
	});
});
