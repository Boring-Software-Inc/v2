import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { GitCafeReadResource } from "@tripwire/forge-gitcafe";
import {
	GitCafeInstallationClient,
	GitCafeReads,
} from "@tripwire/forge-gitcafe";
import members from "../fixtures/gitcafe-connection-members.json";
import installation from "../fixtures/gitcafe-installation.json";
import token from "../fixtures/gitcafe-installation-token.json";
import publicPull from "../fixtures/gitcafe-pull.json";
import collaborators from "../fixtures/gitcafe-read-collaborators.json";
import profile from "../fixtures/gitcafe-read-profile.json";
import pulls from "../fixtures/gitcafe-read-pulls.json";
import scratchBlob from "../fixtures/gitcafe-read-scratch-blob-0.json";
import scratchChanges from "../fixtures/gitcafe-read-scratch-changes.json";
import scratchCommits from "../fixtures/gitcafe-read-scratch-commits.json";
import scratchDiff from "../fixtures/gitcafe-read-scratch-diff-0.json";
import scratchPull from "../fixtures/gitcafe-read-scratch-pull.json";
import blob from "../fixtures/gitcafe-source.json";

const credentials = {
	appId: installation.appId,
	keyId: "test-only",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};
const NOW = Date.parse(token.expiresAt) - 15 * 60_000;
const REPO = "boring/scratch";
type Route = (url: URL) => Response | Promise<Response>;
function harness(
	route: Route,
	guard: () => Promise<boolean> = async () => true,
) {
	const calls: URL[] = [];
	const client = new GitCafeInstallationClient({
		credentials,
		now: () => NOW,
		lifecycleGuard: guard,
		fetch: async (url, init) => {
			const u = new URL(url);
			calls.push(u);
			expect(init.redirect).toBe("manual");
			if (u.pathname.endsWith("/access_tokens"))
				return Response.json({ ...token, token: "adversarial-test-token" });
			if (u.pathname.includes("/apps/installations/"))
				return Response.json(installation);
			return route(u);
		},
	});
	return {
		calls,
		client,
		reads: new GitCafeReads({ client, installationId: installation.id }),
	};
}
function capturedRoute(url: URL): Response {
	if (url.pathname === "/api/users/grim") return Response.json(profile);
	if (url.pathname === "/api/orgs/boring/members/")
		return Response.json(members);
	if (url.pathname.endsWith("/collaborators/"))
		return Response.json(collaborators);
	if (url.pathname.endsWith("/pulls/")) return Response.json(pulls);
	if (url.pathname.endsWith("/blob")) return Response.json(blob);
	return new Response("unexpected request", { status: 500 });
}

describe("GitCafeReads captured reads", () => {
	test("uses real profile bio and stable actor ID, with unavailable global facts null", async () => {
		const h = harness(capturedRoute);
		expect(await h.reads.getContributorProfile(REPO, "grim")).toEqual({
			ok: true,
			value: {
				login: "grim",
				externalId: profile.actorId,
				profileText: profile.bio,
				createdAt: null,
				followers: null,
				following: null,
				publicRepos: null,
				mergedInRepo: 0,
				mergedElsewhere: null,
				recentChangeRequestTimes: null,
				isOrgMember: true,
				isMaintainer: true,
			},
		});
	});
	test("reads text only at the requested exact commit", async () => {
		const h = harness(capturedRoute);
		expect(await h.reads.readFile(REPO, blob.path, blob.commit)).toEqual({
			ok: true,
			value: blob.content,
		});
		const request = h.calls.find((u) => u.pathname.endsWith("/blob"));
		expect(request?.searchParams.get("oid")).toBe(blob.commit);
		expect(request?.searchParams.has("ref")).toBe(false);
	});
	test("unauthorized scope or path refuses before protected GET", async () => {
		const h = harness(capturedRoute);
		for (const repo of [
			"https://evil.test/a",
			"boring/../scratch",
			"boring/%2e%2e",
			"boring/scratch?leak=1",
		]) {
			expect((await h.reads.readFile(repo, "README.md", blob.commit)).ok).toBe(
				false,
			);
		}
		expect(h.calls).toHaveLength(0);
		expect(
			(await h.reads.readFile("other/scratch", "README.md", blob.commit)).ok,
		).toBe(false);
		expect(
			h.calls.every((u) => u.pathname.includes("/apps/installations/")),
		).toBe(true);
	});
});

test("genuine nonempty scratch PR reads preserve provider null aggregates while supplying verified per-file hunks", async () => {
	const h = harness((u) => {
		if (/\/pulls\/1$/.test(u.pathname)) return Response.json(scratchPull);
		if (u.pathname.endsWith("/changes")) return Response.json(scratchChanges);
		if (u.pathname.endsWith("/commits")) return Response.json(scratchCommits);
		if (u.pathname.endsWith("/diff-file")) return Response.json(scratchDiff);
		if (u.pathname.endsWith("/blob")) return Response.json(scratchBlob);
		return capturedRoute(u);
	});
	const diff = await h.reads.getDiff(REPO, 1, {
		sha: scratchPull.headOid,
		baseRef: scratchPull.targetBranch,
	});
	expect(diff.ok).toBe(true);
	if (!diff.ok) throw new Error("captured scratch diff unavailable");
	expect(diff.value).toHaveLength(1);
	expect(diff.value[0]?.path).toBe("tripwire-qa.txt");
	expect(diff.value[0]?.additions).toBe(2);
	expect(diff.value[0]?.deletions).toBe(0);
	expect(diff.value[0]?.patchUnavailable).toBeNull();
	expect(diff.value[0]?.patch).toStartWith("@@ -1,0 +1,2 @@\n+");
	const commits = await h.reads.getCommits(REPO, 1);
	expect(commits.ok && commits.value.map((c) => c.sha)).toEqual([
		scratchPull.headOid,
	]);
	expect(
		await h.reads.readFile(REPO, scratchBlob.path, scratchPull.headOid),
	).toEqual({ ok: true, value: scratchBlob.content });
});

for (const hunks of [scratchDiff.file.hunks, []]) {
	test(`explicitly omitted hunks retain counted file metadata with ${hunks.length} supplied hunks`, async () => {
		const h = harness((u) => {
			if (/\/pulls\/1$/.test(u.pathname)) return Response.json(scratchPull);
			if (u.pathname.endsWith("/changes")) return Response.json(scratchChanges);
			if (u.pathname.endsWith("/diff-file"))
				return Response.json({
					...scratchDiff,
					file: { ...scratchDiff.file, hunksOmitted: true, hunks },
				});
			return capturedRoute(u);
		});
		expect(await h.reads.getDiff(REPO, 1)).toMatchObject({
			ok: true,
			value: [
				{
					path: "tripwire-qa.txt",
					additions: 2,
					deletions: 0,
					patchUnavailable: "omitted",
				},
			],
		});
		const result = await h.reads.getDiff(REPO, 1);
		expect(result.ok && result.value[0]?.patch).toBeUndefined();
	});
}

/** Controlled protocol peers are adversarial inputs, never captured provider fixtures. */
const ADVERSARIAL_PULL = {
	...publicPull,
	repoId: "adversarial-repo",
	changedFiles: null,
	additions: null,
	deletions: null,
};
const ADVERSARIAL_SNAPSHOT = {
	id: publicPull.id,
	version: publicPull.version,
	headOid: publicPull.headOid,
	baseOid: publicPull.observedBaseOid,
	comparisonBaseOid: publicPull.observedBaseOid,
};
const ADVERSARIAL_CHANGE = {
	path: "adversarial.txt",
	status: "modified",
	binary: false,
	hunksOmitted: false,
};
const ADVERSARIAL_HUNKS = [
	{
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 1,
		lines: [
			{ origin: "-", content: "old\n" },
			{ origin: "+", content: "new\n" },
		],
	},
];
const ADVERSARIAL_COMMIT = {
	oid: publicPull.headOid,
	message: "adversarial",
	author: { email: "", timestamp: 1_000 },
};
function adversarialRoute(
	overrides: Route = () => new Response(null, { status: 599 }),
): Route {
	return async (url) => {
		const override = await overrides(url);
		if (override.status !== 599) return override;
		if (/\/pulls\/1$/.test(url.pathname))
			return Response.json(ADVERSARIAL_PULL);
		if (url.pathname.endsWith("/changes"))
			return Response.json({
				...ADVERSARIAL_SNAPSHOT,
				items: [ADVERSARIAL_CHANGE],
				next: null,
			});
		if (url.pathname.endsWith("/diff-file"))
			return Response.json({
				...ADVERSARIAL_SNAPSHOT,
				file: { ...ADVERSARIAL_CHANGE, hunks: ADVERSARIAL_HUNKS },
			});
		if (url.pathname.endsWith("/commits"))
			return Response.json({
				...ADVERSARIAL_SNAPSHOT,
				items: [ADVERSARIAL_COMMIT],
				truncated: false,
				next: null,
			});
		return capturedRoute(url);
	};
}

describe("adversarial protocol peers (not provider fixtures)", () => {
	test("derives absent counts solely from complete hunks, pins every request", async () => {
		const h = harness(adversarialRoute());
		expect(
			await h.reads.getDiff(REPO, 1, {
				sha: publicPull.headOid,
				baseRef: publicPull.targetBranch,
			}),
		).toEqual({
			ok: true,
			value: [
				{
					path: "adversarial.txt",
					status: "modified",
					additions: 1,
					deletions: 1,
					patch: "@@ -1,1 +1,1 @@\n-old\n+new\n",
					patchUnavailable: null,
				},
			],
		});
		for (const call of h.calls.filter((u) =>
			/\/(changes|diff-file)$/.test(u.pathname),
		))
			expect(call.searchParams.get("expectedVersion")).toBe(
				String(publicPull.version),
			);
	});
	test("preserves file count when counters and hunks are unavailable", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname.endsWith("/diff-file")
					? Response.json({
							...ADVERSARIAL_SNAPSHOT,
							file: { ...ADVERSARIAL_CHANGE, hunksOmitted: true },
						})
					: new Response(null, { status: 599 }),
			),
		);
		expect(await h.reads.getDiff(REPO, 1)).toEqual({
			ok: true,
			value: [
				{
					path: "adversarial.txt",
					status: "modified",
					additions: null,
					deletions: null,
					patchUnavailable: "omitted",
				},
			],
		});
	});
	test("retains per-file sanitized failures without inventing counts", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname.endsWith("/diff-file")
					? new Response("private provider detail", { status: 503 })
					: new Response(null, { status: 599 }),
			),
		);
		expect(await h.reads.getDiff(REPO, 1)).toEqual({
			ok: true,
			value: [
				{
					path: "adversarial.txt",
					status: "modified",
					additions: null,
					deletions: null,
					patchUnavailable: "unavailable",
					detailFailure: { ok: false, reason: "http", status: 503 },
				},
			],
		});
	});
	test("paginates distinct files and commits completely", async () => {
		const h = harness(
			adversarialRoute((u) => {
				if (u.pathname.endsWith("/changes"))
					return Response.json({
						...ADVERSARIAL_SNAPSHOT,
						items: [
							{
								...ADVERSARIAL_CHANGE,
								path: u.searchParams.has("after")
									? "second.txt"
									: "adversarial.txt",
							},
						],
						next: u.searchParams.has("after") ? null : "cursor2",
					});
				if (u.pathname.endsWith("/diff-file"))
					return Response.json({
						...ADVERSARIAL_SNAPSHOT,
						file: {
							...ADVERSARIAL_CHANGE,
							path: u.searchParams.get("path"),
							hunks: ADVERSARIAL_HUNKS,
						},
					});
				if (u.pathname.endsWith("/commits"))
					return Response.json({
						...ADVERSARIAL_SNAPSHOT,
						items: [
							{
								...ADVERSARIAL_COMMIT,
								oid: u.searchParams.has("after")
									? "1".repeat(40)
									: ADVERSARIAL_COMMIT.oid,
							},
						],
						next: u.searchParams.has("after") ? null : "cursor2",
						truncated: false,
					});
				return new Response(null, { status: 599 });
			}),
		);
		const diff = await h.reads.getDiff(REPO, 1);
		expect(diff.ok && diff.value.length).toBe(2);
		const commits = await h.reads.getCommits(REPO, 1);
		expect(commits.ok && commits.value.length).toBe(2);
		expect(commits.ok && commits.value[0]).toEqual({
			sha: publicPull.headOid,
			message: "adversarial",
			authorEmail: null,
			authorLogin: null,
			authoredAt: "1970-01-01T00:16:40.000Z",
		});
	});
	test("rejects cursor loops, duplicates, and pages without progress", async () => {
		for (const page of [
			{ items: [ADVERSARIAL_CHANGE], next: "loop" },
			{ items: [], next: "more" },
			{ items: [ADVERSARIAL_CHANGE, ADVERSARIAL_CHANGE], next: null },
		]) {
			const h = harness(
				adversarialRoute((u) =>
					u.pathname.endsWith("/changes")
						? Response.json({ ...ADVERSARIAL_SNAPSHOT, ...page })
						: new Response(null, { status: 599 }),
				),
			);
			expect(await h.reads.getDiff(REPO, 1)).toEqual({
				ok: false,
				reason: "pagination",
			});
		}
	});
	test("rejects truncated commits independently of diff", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname.endsWith("/commits")
					? Response.json({
							...ADVERSARIAL_SNAPSHOT,
							items: [ADVERSARIAL_COMMIT],
							next: null,
							truncated: true,
						})
					: new Response(null, { status: 599 }),
			),
		);
		expect(await h.reads.getCommits(REPO, 1)).toEqual({
			ok: false,
			reason: "incomplete",
		});
		expect((await h.reads.getDiff(REPO, 1)).ok).toBe(true);
	});
	test("rejects changed head, version, base and comparison base", async () => {
		for (const [key, value] of [
			["headOid", "2".repeat(40)],
			["version", 999],
			["baseOid", "3".repeat(40)],
			["comparisonBaseOid", "4".repeat(40)],
		]) {
			const h = harness(
				adversarialRoute((u) =>
					u.pathname.endsWith("/diff-file")
						? Response.json({
								...ADVERSARIAL_SNAPSHOT,
								[String(key)]: value,
								file: { ...ADVERSARIAL_CHANGE, hunks: ADVERSARIAL_HUNKS },
							})
						: new Response(null, { status: 599 }),
				),
			);
			expect(await h.reads.getDiff(REPO, 1)).toEqual({
				ok: false,
				reason: "changed",
			});
		}
	});
	test("rechecks current base at completion", async () => {
		let pages = 0;
		const h = harness(
			adversarialRoute((u) => {
				if (u.pathname.endsWith("/commits"))
					return Response.json({
						...ADVERSARIAL_SNAPSHOT,
						baseOid:
							++pages > 1 ? "5".repeat(40) : ADVERSARIAL_SNAPSHOT.baseOid,
						items: [ADVERSARIAL_COMMIT],
						truncated: false,
						next: null,
					});
				return new Response(null, { status: 599 });
			}),
		);
		expect(await h.reads.getCommits(REPO, 1)).toEqual({
			ok: false,
			reason: "changed",
		});
	});
	test("never reads a different event head or mutable branch file ref", async () => {
		const h = harness(adversarialRoute());
		expect(
			await h.reads.getDiff(REPO, 1, {
				sha: "0".repeat(40),
				baseRef: publicPull.targetBranch,
			}),
		).toEqual({ ok: false, reason: "changed" });
		expect(await h.reads.readFile(REPO, "README.md", "main")).toEqual({
			ok: false,
			reason: "invalid-resource-path",
		});
		expect(
			h.calls.filter(
				(u) =>
					u.pathname.endsWith("/diff-file") || u.pathname.endsWith("/blob"),
			),
		).toHaveLength(0);
	});
	test("rejects incomplete hunks and dishonest counters", async () => {
		for (const file of [
			{
				...ADVERSARIAL_CHANGE,
				hunks: [{ ...ADVERSARIAL_HUNKS[0], oldLines: 5 }],
			},
			{ ...ADVERSARIAL_CHANGE, hunks: ADVERSARIAL_HUNKS, additions: 0 },
		]) {
			const h = harness(
				adversarialRoute((u) =>
					u.pathname.endsWith("/diff-file")
						? Response.json({ ...ADVERSARIAL_SNAPSHOT, file })
						: new Response(null, { status: 599 }),
				),
			);
			expect(await h.reads.getDiff(REPO, 1)).toEqual({
				ok: false,
				reason: "incomplete",
			});
		}
	});
	test("profile reassignment cannot borrow membership or maintainer authority", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname === "/api/users/grim"
					? Response.json({ ...profile, actorId: "adversarial-other-actor" })
					: new Response(null, { status: 599 }),
			),
		);
		const result = await h.reads.getContributorProfile(REPO, "grim");
		expect(result.ok && result.value.externalId).toBe(
			"adversarial-other-actor",
		);
		expect(result.ok && result.value.isOrgMember).toBe(false);
		expect(result.ok && result.value.isMaintainer).toBeNull();
	});
	test("a failed membership read stays unknown, separate from direct collaborator authority", async () => {
		const h = harness(
			adversarialRoute((u) => {
				if (u.pathname.endsWith("/members/"))
					return new Response("secret details", { status: 403 });
				if (u.pathname.endsWith("/collaborators/"))
					return Response.json({
						items: [{ actorId: profile.actorId, role: "repo-writer" }],
						next: null,
					});
				return new Response(null, { status: 599 });
			}),
		);
		const result = await h.reads.getContributorProfile(REPO, "grim");
		expect(result.ok && result.value.isOrgMember).toBeNull();
		expect(result.ok && result.value.isMaintainer).toBe(true);
	});
	test("failed history cannot masquerade as zero accepted contributions", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname.endsWith("/pulls/")
					? new Response(null, { status: 503 })
					: new Response(null, { status: 599 }),
			),
		);
		const result = await h.reads.getContributorProfile(REPO, "grim");
		expect(result.ok && result.value.mergedInRepo).toBeNull();
	});
	test("blob mismatch, binary, and missing content are unavailable", async () => {
		for (const overrides of [
			{ commit: "0".repeat(40) },
			{ path: "different" },
			{ binary: true },
			{ content: null },
			{ size: 1 },
		]) {
			const h = harness((u) =>
				u.pathname.endsWith("/blob")
					? Response.json({ ...blob, ...overrides })
					: capturedRoute(u),
			);
			expect((await h.reads.readFile(REPO, blob.path, blob.commit)).ok).toBe(
				false,
			);
		}
	});
	test("GET errors are bounded and never leak provider bodies or redirects", async () => {
		for (const response of [
			new Response("private-token-must-not-leak", { status: 500 }),
			new Response(null, {
				status: 302,
				headers: { location: "https://evil.test" },
			}),
			Response.json({ unexpected: "private-token-must-not-leak" }),
			Response.json({ content: "x".repeat(1024 * 1024) }),
		]) {
			const h = harness(() => response);
			const result = await h.reads.readFile(REPO, blob.path, blob.commit);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain("private-token");
			expect(h.calls.every((u) => u.host === "git.cafe")).toBe(true);
		}
	});
	test("local inactive lifecycle refuses before assertion lookup, mint, or credential use", async () => {
		const h = harness(capturedRoute, async () => false);
		expect(await h.reads.getContributorProfile(REPO, "grim")).toEqual({
			ok: false,
			reason: "inactive",
		});
		expect(h.calls).toHaveLength(0);
	});
	test("read clients require a local lifecycle guard", async () => {
		const client = new GitCafeInstallationClient({ credentials });
		expect(
			await client.readResource(installation.id, REPO, {
				kind: "profile",
				login: "grim",
			}),
		).toEqual({ ok: false, reason: "configuration" });
	});
	test("invalidation during a resource request fences its response", async () => {
		const h = harness(async (u) => {
			h.client.invalidate(installation.id);
			return capturedRoute(u);
		});
		expect(await h.reads.getContributorProfile(REPO, "grim")).toEqual({
			ok: false,
			reason: "stale",
		});
	});
	test("lifecycle changes during token mint prevent token use", async () => {
		let checks = 0;
		const h = harness(capturedRoute, async () => ++checks < 7);
		expect((await h.reads.getContributorProfile(REPO, "grim")).ok).toBe(false);
		expect(h.calls.some((u) => u.pathname === "/api/users/grim")).toBe(false);
	});
	test("a generation change between successful pages refuses the whole operation", async () => {
		let reads = 0;
		const h = harness(
			adversarialRoute((u) => {
				if (u.pathname.endsWith("/commits")) {
					reads++;
					if (reads === 1)
						queueMicrotask(() => h.client.invalidate(installation.id));
					return Response.json({
						...ADVERSARIAL_SNAPSHOT,
						items: [ADVERSARIAL_COMMIT],
						truncated: false,
						next: null,
					});
				}
				return new Response(null, { status: 599 });
			}),
		);
		expect(await h.reads.getCommits(REPO, 1)).toEqual({
			ok: false,
			reason: "stale",
		});
	});
	test("repository-local merged history exhausts more than 100 records and filters stable actors", async () => {
		const h = harness(
			adversarialRoute((u) => {
				if (u.pathname.endsWith("/pulls/")) {
					expect(u.searchParams.get("state")).toBe("merged");
					const second = u.searchParams.has("after");
					return Response.json({
						items: Array.from({ length: second ? 1 : 100 }, (_, i) => ({
							...publicPull,
							id: `adversarial-${second ? 100 : i}`,
							number: (second ? 100 : i) + 1,
							authorActorId: second
								? profile.actorId
								: publicPull.authorActorId,
						})),
						next: second ? null : "nextpage",
					});
				}
				return new Response(null, { status: 599 });
			}),
		);
		const result = await h.reads.getContributorProfile(REPO, "grim");
		expect(result.ok && result.value.mergedInRepo).toBe(1);
		expect(result.ok && result.value.recentChangeRequestTimes).toBeNull();
	});
	test("unknown membership cannot exempt and missing direct authority remains unknown", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname.endsWith("/members/")
					? Response.json({
							items: [
								{ actorId: profile.actorId, role: "adversarial-unknown-role" },
							],
							next: null,
						})
					: new Response(null, { status: 599 }),
			),
		);
		const result = await h.reads.getContributorProfile(REPO, "grim");
		expect(result.ok && result.value.isOrgMember).toBe(false);
		expect(result.ok && result.value.isMaintainer).toBeNull();
	});
	test("absent hunk completeness is never fabricated as zero counters", async () => {
		const h = harness(
			adversarialRoute((u) =>
				u.pathname.endsWith("/diff-file")
					? Response.json({
							...ADVERSARIAL_SNAPSHOT,
							file: {
								path: ADVERSARIAL_CHANGE.path,
								status: ADVERSARIAL_CHANGE.status,
								hunks: [],
							},
						})
					: new Response(null, { status: 599 }),
			),
		);
		const result = await h.reads.getDiff(REPO, 1);
		expect(result.ok && result.value[0]?.additions).toBeNull();
		expect(result.ok && result.value[0]?.deletions).toBeNull();
		expect(result.ok && result.value[0]?.patchUnavailable).toBe("unavailable");
	});

	test("unsafe cursors and source paths are refused before credentials", async () => {
		const h = harness(capturedRoute);
		const resources: GitCafeReadResource[] = [
			{ kind: "commits", number: 1, version: 0, after: "https://evil.test" },
			{ kind: "blob", oid: blob.commit, path: "../secret" },
		];
		for (const resource of resources)
			expect(
				(await h.client.readResource(installation.id, REPO, resource)).ok,
			).toBe(false);
		expect(h.calls).toHaveLength(0);
	});
});

describe("shared authorized JSON transport with adversarial HTTP peers", () => {
	test("all methods reuse scoped tokens, bounded JSON responses, and generation fencing", async () => {
		const observed: {
			method: string;
			contentType: string | null;
			body: string | null;
		}[] = [];
		const client = new GitCafeInstallationClient({
			credentials,
			now: () => NOW,
			lifecycleGuard: async () => true,
			fetch: async (url, init) => {
				if (url.endsWith("/access_tokens"))
					return Response.json({ ...token, token: "adversarial-test-token" });
				if (url.includes("/apps/installations/"))
					return Response.json(installation);
				expect(init.redirect).toBe("manual");
				observed.push({
					method: init.method ?? "GET",
					contentType: new Headers(init.headers).get("content-type"),
					body: init.body ? String(init.body) : null,
				});
				return Response.json({ accepted: true });
			},
		});
		const authority = await client.getInstallation(installation.id);
		if (!authority.ok) throw new Error("adversarial installation unavailable");
		for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
			const result = await client.request(
				installation.id,
				{
					method,
					resourcePath: "repos/boring/scratch/pulls/1/status",
					body: method === "GET" ? undefined : '{"adversarial":true}',
				},
				authority.value,
			);
			expect(result).toEqual({ ok: true, value: { accepted: true } });
		}
		expect(observed.map((r) => r.method)).toEqual([
			"GET",
			"POST",
			"PUT",
			"PATCH",
			"DELETE",
		]);
		expect(observed[0]?.contentType).toBeNull();
		expect(observed[1]?.contentType).toBe("application/json");
		expect(observed[1]?.body).toBe('{"adversarial":true}');
	});
	test("public requests reject host escapes, traversal, scope widening, and forged snapshots", async () => {
		const h = harness(capturedRoute);
		const authority = await h.client.getInstallation(installation.id);
		if (!authority.ok) throw new Error("adversarial installation unavailable");
		const calls = h.calls.length;
		for (const resourcePath of [
			"https://evil.test",
			"/repos/boring/scratch",
			"repos/boring/scratch/../../other",
			"repos/boring/scratch/%2e%2e/other",
			"repos/boring/scratch/%2fother",
			"repos/boring/scratch/%5cother",
			"repos/boring/other/pulls/1",
			"repos/other/scratch/pulls/1",
			"repos/boring/scratch/pulls/1#escape",
			"repos/boring/scratch/\nother",
			"repos/boring/scratch/%00other",
			"apps/installations/other",
		]) {
			expect(
				(
					await h.client.request(
						installation.id,
						{ method: "PUT", resourcePath, body: "{}" },
						authority.value,
					)
				).ok,
			).toBe(false);
		}
		expect(
			(
				await h.client.request(
					installation.id,
					{ method: "PUT", resourcePath: "orgs/boring/settings", body: "{}" },
					authority.value,
				)
			).ok,
		).toBe(false);
		expect(h.calls).toHaveLength(calls);
		expect(
			await h.client.request(
				installation.id,
				{ method: "GET", resourcePath: "users/grim" },
				{ ...authority.value },
			),
		).toEqual({ ok: false, reason: "stale" });
		expect(h.calls).toHaveLength(calls);
	});
});
