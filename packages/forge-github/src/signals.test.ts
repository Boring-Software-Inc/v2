import { describe, expect, test } from "bun:test";
import type { RepoScopedEvent } from "@tripwire/contracts";
import {
	createForgeSignalCtx,
	defineForge,
	SignalUnavailableError,
} from "@tripwire/sdk";
import { GithubHttp } from "./client/http.ts";
import { githubForge } from "./signals.ts";

/**
 * The Phase 1 proof: producers share loaders, so evaluating many signals
 * costs the same API volume as today's monolithic pre-fetch (§5.8), and
 * event-derived signals cost zero calls.
 */

const NOW = "2026-07-21T12:00:00.000Z";

const prEvent: RepoScopedEvent = {
	id: "evt-1",
	forge: "github",
	deliveryId: "d-1",
	repo: { owner: "acme", name: "widgets", fullName: "acme/widgets" },
	actor: { login: "mallory", externalId: "77" },
	occurredAt: NOW,
	receivedAt: NOW,
	kind: "change-request.opened",
	changeRequest: {
		number: 42,
		title: "Add feature",
		headSha: "abc123",
		baseRef: "main",
		headRef: "feature",
		draft: false,
		url: "https://github.com/acme/widgets/pull/42",
	},
};

function fakeResponses(): Record<string, unknown> {
	return {
		"/users/mallory": {
			id: 77,
			created_at: "2026-07-11T12:00:00.000Z",
			followers: 3,
			following: 9,
			public_repos: 5,
			bio: "hi",
		},
		"/repos/mallory/mallory/contents/README.md?ref=HEAD": {
			content: Buffer.from("my profile readme").toString("base64"),
			encoding: "base64",
		},
		[`/search/issues?q=${encodeURIComponent("repo:acme/widgets author:mallory is:pr is:merged")}&per_page=1`]:
			{ total_count: 2 },
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr is:merged -user:mallory")}&per_page=1`]:
			{ total_count: 4 },
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr created:>=2026-06-21")}&per_page=100`]:
			{ items: [{ created_at: "2026-07-20T00:00:00.000Z" }] },
		"/repos/acme/widgets/collaborators/mallory/permission": {
			permission: "read",
		},
		"/repos/acme/widgets/pulls/42/files?per_page=100": [
			{ filename: "src/a.ts", patch: "@@ -1 +1 @@" },
			{ filename: "docs/b.md" },
		],
	};
}

function makeCtx(event: RepoScopedEvent = prEvent) {
	const calls: string[] = [];
	const responses = fakeResponses();
	const http = new GithubHttp({
		tokenFor: async () => "test-token",
		fetchImpl: (async (input: string | URL | Request) => {
			const path = String(input).replace("https://api.github.com", "");
			calls.push(path);
			const body = responses[path];
			if (body === undefined) {
				return new Response("not found", { status: 404 });
			}
			return Response.json(body);
		}) as unknown as typeof fetch,
	});
	return { ctx: createForgeSignalCtx({ forge: http, event, now: NOW }), calls };
}

function produce(id: keyof typeof githubForge.produces, ctx: unknown) {
	const producer = githubForge.produces[id];
	if (!producer) {
		throw new Error(`no producer for ${id}`);
	}
	// Async wrapper so a synchronous signalUnavailable throw becomes a rejection.
	// biome-ignore lint/suspicious/noExplicitAny: test drives producers generically
	return (async () => producer(ctx as any))();
}

describe("github forge signals", () => {
	test("five contributor signals share one user fetch", async () => {
		const { ctx, calls } = makeCtx();
		const [age, fol, fing, repos] = await Promise.all([
			produce("contributor.accountAge", ctx),
			produce("contributor.followers", ctx),
			produce("contributor.following", ctx),
			produce("contributor.publicRepos", ctx),
		]);
		expect(age).toBe(10);
		expect(fol).toBe(3);
		expect(fing).toBe(9);
		expect(repos).toBe(5);
		expect(calls.filter((c) => c === "/users/mallory")).toHaveLength(1);
		expect(calls).toHaveLength(1);
	});

	test("three pr signals share one files fetch", async () => {
		const { ctx, calls } = makeCtx();
		const [count, paths, patches] = await Promise.all([
			produce("pr.filesChanged", ctx),
			produce("pr.changedPaths", ctx),
			produce("pr.patchByPath", ctx),
		]);
		expect(count).toBe(2);
		expect(paths).toEqual(["src/a.ts", "docs/b.md"]);
		expect(patches).toEqual({ "src/a.ts": "@@ -1 +1 @@" });
		expect(calls).toHaveLength(1);
	});

	test("every supported signal on a PR event costs seven calls, same as today's pre-fetch", async () => {
		const { ctx, calls } = makeCtx();
		const ids = Object.keys(githubForge.produces).filter(
			(id) => id !== "comment.body",
		) as (keyof typeof githubForge.produces)[];
		const values = Object.fromEntries(
			await Promise.all(ids.map(async (id) => [id, await produce(id, ctx)])),
		);
		expect(values["contributor.profileText"]).toBe("my profile readme");
		expect(values["contributor.mergedElsewhere"]).toBe(4);
		expect(values["repoRelation.mergedInRepo"]).toBe(2);
		expect(values["repoRelation.isMaintainer"]).toBe(false);
		expect(values["pr.title"]).toBe("Add feature");
		expect(values["contributor.recentChangeRequestTimes"]).toEqual([
			"2026-07-20T00:00:00.000Z",
		]);
		// user, profile readme, 3 searches, permission, pr files. Today's
		// pre-fetch spends the same 6 profile calls + 1 diff call (plus a
		// commits call the signal path no longer needs).
		expect(calls).toHaveLength(7);
		expect(new Set(calls).size).toBe(7);
	});

	test("event-derived signals cost zero API calls", async () => {
		const { ctx, calls } = makeCtx();
		await expect(produce("pr.title", ctx)).resolves.toBe("Add feature");
		expect(calls).toHaveLength(0);
	});

	test("comment.body on a PR event is unavailable, not an error", async () => {
		const { ctx } = makeCtx();
		await expect(produce("comment.body", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
	});

	test("a failed global-merge search is unavailable, a failed in-repo search counts zero", async () => {
		const { ctx } = makeCtx();
		// Unknown login busts every canned response, so the searches 404.
		const brokenEvent = {
			...prEvent,
			actor: { login: "ghost", externalId: "0" },
		};
		const { ctx: brokenCtx } = makeCtx(brokenEvent);
		await expect(
			produce("contributor.mergedElsewhere", brokenCtx),
		).rejects.toBeInstanceOf(SignalUnavailableError);
		await expect(produce("repoRelation.mergedInRepo", brokenCtx)).resolves.toBe(
			0,
		);
		await expect(produce("contributor.mergedElsewhere", ctx)).resolves.toBe(4);
	});
});

describe("defineForge type flow", () => {
	test("a producer's return type is enforced against the signal's declared type", () => {
		// Compile-time proof, mirrored from the approved spike.
		defineForge<GithubHttp>()({
			id: "bad",
			produces: {
				// @ts-expect-error accountAge is a number signal; a text producer must not compile
				"contributor.accountAge": async () => "not a number",
			},
		});
		expect(true).toBe(true);
	});
});
