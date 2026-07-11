import { describe, expect, test } from "bun:test";
import { GithubHttp } from "../client/http.ts";
import { CHECK_NAME, setCheck } from "./check.ts";
import { COMMENT_MARKER, renderCommentBody, upsertComment } from "./comment.ts";

/**
 * §11 snapshot layer: rendered PR comments vs golden files — the presenter
 * physically cannot write an essay. Plus fake-fetch upsert semantics: one
 * comment per thread, one check per SHA, edits never appends.
 */

describe("renderCommentBody — snapshot golden files", () => {
	test("blocked", () => {
		expect(
			renderCommentBody({
				verdict: "block",
				sentence: "2 of 6 rules failed; merge is held.",
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("passed", () => {
		expect(
			renderCommentBody({
				verdict: "pass",
				sentence: "all 6 rules passed.",
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("sent to review", () => {
		expect(
			renderCommentBody({
				verdict: "needs_review",
				sentence: "awaiting moderation — a maintainer decides next.",
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("is condensed: verdict line + one sentence + one button + marker", () => {
		const body = renderCommentBody({
			verdict: "block",
			sentence: "multi\nline\nsentence   collapses.",
			runUrl: "https://tripwire.sh/runs/x",
			badgeUrl: "https://tripwire.sh/badges/view-run.png",
		});
		const lines = body.trim().split("\n").filter(Boolean);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("**tripwire: blocked**");
		expect(lines[0]).toContain("multi line sentence collapses.");
		expect(lines[1]).toContain("badges/view-run.png");
		expect(lines[1]).toContain('href="https://tripwire.sh/runs/x"');
		expect(lines[2]).toBe(COMMENT_MARKER);
	});
});

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

describe("upsertComment", () => {
	test("creates when no marker comment exists", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [
				{ id: 1, body: "unrelated comment" },
			],
			"POST /repos/a/b/issues/7/comments": { id: 42 },
		});
		const result = await upsertComment(http, "a/b", 7, "body");
		expect(result).toEqual({ externalId: "42", created: true });
		expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
	});

	test("edits the existing marker comment — never appends", async () => {
		const { http, calls } = fakeHttp({
			"GET /repos/a/b/issues/7/comments": [
				{ id: 9, body: `old body\n${COMMENT_MARKER}` },
			],
		});
		const result = await upsertComment(http, "a/b", 7, "new body");
		expect(result).toEqual({ externalId: "9", created: false });
		const patch = calls.find((c) => c.method === "PATCH");
		expect(patch?.path).toBe("/repos/a/b/issues/comments/9");
		expect(patch?.body).toEqual({ body: "new body" });
	});
});

describe("setCheck", () => {
	const state = {
		sha: "a".repeat(40),
		conclusion: "failure" as const,
		summary: "tripwire: blocked — 2 of 6 rules failed; merge is held.",
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
			reason:
				"**tripwire: blocked** — 2 of 6 rules failed; merge is held. details: https://tripwire.sh/runs/x",
		});
		expect(result.externalId).toBe("91");
		const post = calls.find((c) => c.method === "POST");
		expect(post?.path).toBe("/repos/a/b/pulls/7/reviews");
		expect(post?.body).toMatchObject({ event: "REQUEST_CHANGES" });
		expect(String((post?.body as { body: string }).body)).toContain(
			"tripwire: blocked",
		);
	});
});
