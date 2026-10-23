import { describe, expect, test } from "bun:test";
import { actionCommentMarker } from "@tripwire/contracts";
import issueComment from "../../fixtures/issue_comment.created.json";
import { GithubHttp } from "../client/http.ts";
import { listRepoLabels } from "../client/labels.ts";
import { executeAction } from "./execute.ts";

const API = "https://fake.api";
const APP_ID = 4291944;
const OURS = { performed_via_github_app: { id: APP_ID } };
const LABEL = issueComment.issue.labels[0];
const COMMENT = issueComment.comment;

interface Reply {
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
}

function fakeHttp(reply: (method: string, path: string) => Reply) {
	const calls: { method: string; path: string; body: unknown }[] = [];
	const http = new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		appId: APP_ID,
		apiBase: API,
		fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			const path = String(url).replace(API, "");
			calls.push({
				method,
				path,
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			const answer = reply(method, path);
			return Promise.resolve(
				new Response(
					answer.status === 204 ? null : JSON.stringify(answer.body ?? {}),
					{ status: answer.status ?? 200, headers: answer.headers ?? {} },
				),
			);
		}) as typeof fetch,
	});
	return { http, calls };
}

const MARKER = actionCommentMarker({
	workflowId: "wf",
	nodeId: "warn",
	runId: "run-1",
});

describe("remove-label", () => {
	test("deletes each label by its encoded name", async () => {
		const { http, calls } = fakeHttp(() => ({ body: [] }));
		await executeAction(http, {
			kind: "remove-label",
			repoFullName: "a/b",
			number: 4,
			labels: ["PR: stale", "bug"],
		});
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"DELETE /repos/a/b/issues/4/labels/PR%3A%20stale",
			"DELETE /repos/a/b/issues/4/labels/bug",
		]);
	});

	test("a label that is not there counts as removed", async () => {
		const { http } = fakeHttp(() => ({
			status: 404,
			body: {
				message: "Label does not exist",
				documentation_url:
					"https://docs.github.com/rest/issues/labels#remove-a-label-from-an-issue",
			},
		}));
		await expect(
			executeAction(http, {
				kind: "remove-label",
				repoFullName: "a/b",
				number: 4,
				labels: ["stale"],
			}),
		).resolves.toEqual({ externalId: null });
	});

	test("other failures throw so the row stays recorded", async () => {
		const { http } = fakeHttp(() => ({ status: 500, body: {} }));
		await expect(
			executeAction(http, {
				kind: "remove-label",
				repoFullName: "a/b",
				number: 4,
				labels: ["stale"],
			}),
		).rejects.toThrow(/failed: 500/);
	});
});

describe("post-comment", () => {
	test("posts the message with its own marker", async () => {
		const { http, calls } = fakeHttp((method) =>
			method === "GET"
				? { body: [{ ...COMMENT, body: "<!-- tripwire:run --> verdict" }] }
				: { status: 201, body: { ...COMMENT, id: 77 } },
		);
		const result = await executeAction(http, {
			kind: "post-comment",
			repoFullName: "a/b",
			number: 4,
			body: "This will close in 7 days.",
			marker: MARKER,
		});
		expect(result).toEqual({ externalId: "77" });
		expect(calls.at(-1)).toEqual({
			method: "POST",
			path: "/repos/a/b/issues/4/comments",
			body: { body: `This will close in 7 days.\n\n${MARKER}` },
		});
	});

	test("a retry finds the comment it already posted", async () => {
		const { http, calls } = fakeHttp((_, path) =>
			path.includes("page=2")
				? {
						body: [
							{ ...COMMENT, ...OURS, id: 91, body: `Earlier.\n\n${MARKER}` },
						],
					}
				: {
						body: [COMMENT],
						headers: {
							link: `<${API}/repositories/1/issues/4/comments?per_page=100&page=2>; rel="next"`,
						},
					},
		);
		const result = await executeAction(http, {
			kind: "post-comment",
			repoFullName: "a/b",
			number: 4,
			body: "This will close in 7 days.",
			marker: MARKER,
		});
		expect(result).toEqual({ externalId: "91" });
		expect(calls.every((call) => call.method === "GET")).toBe(true);
	});

	test("a contributor comment copying the marker does not stop the post", async () => {
		const { http, calls } = fakeHttp((method) =>
			method === "GET"
				? { body: [{ ...COMMENT, body: `Fake.\n\n${MARKER}` }] }
				: { status: 201, body: { ...COMMENT, id: 79 } },
		);
		const result = await executeAction(http, {
			kind: "post-comment",
			repoFullName: "a/b",
			number: 4,
			body: "This will close in 7 days.",
			marker: MARKER,
		});
		expect(result).toEqual({ externalId: "79" });
		expect(calls.at(-1)?.method).toBe("POST");
	});

	test("a comment from another node or run is not a match", async () => {
		const other = actionCommentMarker({
			workflowId: "wf",
			nodeId: "warn",
			runId: "run-0",
		});
		const { http, calls } = fakeHttp((method) =>
			method === "GET"
				? { body: [{ ...COMMENT, body: `Old.\n\n${other}` }] }
				: { status: 201, body: { ...COMMENT, id: 78 } },
		);
		await executeAction(http, {
			kind: "post-comment",
			repoFullName: "a/b",
			number: 4,
			body: "Again.",
			marker: MARKER,
		});
		expect(calls.at(-1)?.method).toBe("POST");
	});
});

describe("listRepoLabels", () => {
	test("reads every page and keeps name, color and description", async () => {
		const { http, calls } = fakeHttp((_, path) =>
			path.includes("page=2")
				? {
						body: [
							{
								...LABEL,
								name: "no-auto-close",
								color: "ededed",
								description: "Never closed by a schedule",
							},
						],
					}
				: {
						body: [LABEL, { ...LABEL, name: "broken", color: "nothex" }],
						headers: {
							link: `<${API}/repositories/1/labels?per_page=100&page=2>; rel="next"`,
						},
					},
		);
		const labels = await listRepoLabels(http, "Codertocat/Hello-World");
		expect(labels).toEqual([
			{ name: "bug", color: "d73a4a", description: null },
			{
				name: "no-auto-close",
				color: "ededed",
				description: "Never closed by a schedule",
			},
		]);
		expect(calls.map((call) => call.path)).toEqual([
			"/repos/Codertocat/Hello-World/labels?per_page=100",
			"/repositories/1/labels?per_page=100&page=2",
		]);
	});
});
