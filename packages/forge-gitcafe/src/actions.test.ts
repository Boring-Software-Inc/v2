import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	COMMENT_MARKER,
	type GitCafeActionOperation,
	gitCafeActionBindingSchema,
	gitCafeActionCommentPageSchema,
	gitCafeActionCommentSchema,
	gitCafeActionCommentWriteSchema,
	gitCafeActionCreatedReviewSchema,
	gitCafeActionLabelInputSchema,
	gitCafeActionLabelPageSchema,
	gitCafeActionReviewerInputSchema,
	gitCafeActionReviewerPageSchema,
	gitCafeActionReviewPageSchema,
	gitCafeActionReviewSchema,
	gitCafeActionSubjectSchema,
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
} from "@tripwire/contracts";
import type { ForgeAction } from "@tripwire/forge";
import { generateId } from "@tripwire/utils";
import commentCreated from "../fixtures/gitcafe-action-comment-created.json";
import deletionRefused from "../fixtures/gitcafe-action-comment-deleted.json";
import commentEdited from "../fixtures/gitcafe-action-comment-edited.json";
import commentsBefore from "../fixtures/gitcafe-action-comments-before.json";
import commentsPopulated from "../fixtures/gitcafe-action-comments-populated.json";
import installationFixture from "../fixtures/gitcafe-action-installation-current.json";
import labelsFixture from "../fixtures/gitcafe-action-labels-current.json";
import reviewCreated from "../fixtures/gitcafe-action-review-created.json";
import dismissal from "../fixtures/gitcafe-action-review-dismissed.json";
import reviewDismissed from "../fixtures/gitcafe-action-review-dismissed-readback.json";
import reviewReadback from "../fixtures/gitcafe-action-review-readback.json";
import candidatesFixture from "../fixtures/gitcafe-action-reviewer-candidates.json";
import reviewersFixture from "../fixtures/gitcafe-action-reviewers-current.json";
import reviewsPopulated from "../fixtures/gitcafe-action-reviews-populated.json";
import tokenFixture from "../fixtures/gitcafe-action-token-current.json";
import pullFixture from "../fixtures/gitcafe-read-scratch-pull.json";
import { GitCafeActions } from "./actions.ts";
import { GitCafeInstallationClient } from "./installation-client.ts";

const installation = gitCafeInstallationSchema.parse(installationFixture);
const token = gitCafeInstallationTokenSchema.parse(tokenFixture);
const pull = gitCafeActionSubjectSchema.parse(pullFixture);
const credentials = {
	appId: installation.appId,
	keyId: "local-action-test",
	privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
};
const root = "https://git.cafe/api/repos/boring/scratch/pulls/1";

async function harness(
	resource: (url: string, init: RequestInit) => Promise<Response>,
) {
	const client = new GitCafeInstallationClient({
		credentials,
		lifecycleGuard: async () => true,
		fetch: async (url, init) => {
			if (url.includes("/api/apps/"))
				return Response.json(
					init.method === "GET"
						? installation
						: {
								...token,
								token: "local-action-token",
								expiresAt: new Date(Date.now() + 900_000).toISOString(),
							},
				);
			return resource(url, init);
		},
	});
	const lookup = await client.getInstallation(installation.id);
	if (!lookup.ok) throw new Error("Local installation fixture failed");
	const binding = gitCafeActionBindingSchema.parse({
		actionId: generateId(),
		installationId: installation.id,
		repositoryId: pull.repoId,
		repoFullName: "boring/scratch",
		subject: "change-request",
		number: 1,
		headOid: pull.headOid,
		recordedAt: new Date().toISOString(),
	});
	let operation: GitCafeActionOperation | undefined;
	const store = {
		dispatchReview: async () => {
			if (!operation) return false;
			operation = { ...operation, dispatched: true };
			return true;
		},
		releaseReview: async () => {
			if (operation) operation = { ...operation, dispatched: false };
		},
		recordReviewReceipt: async (_id: string, reviewId: string) => {
			if (!operation) return false;
			operation = { ...operation, reviewReceipt: reviewId };
			return true;
		},
		pendingReviews: async () => [],
		read: async () => operation ?? null,
		prepare: async (candidate: GitCafeActionOperation) => {
			operation ??= candidate;
			return operation;
		},
		claimComment: async () => {
			if (!operation || operation.dispatched) return false;
			operation = { ...operation, dispatched: true };
			return true;
		},
		releaseComment: async () => {
			if (operation) operation = { ...operation, dispatched: false };
		},
	};
	return {
		binding,
		operation: () => operation,
		actions: new GitCafeActions({ client, installation: lookup.value, store }),
	};
}

for (const source of ["github", "provider", "unsupported"] as const) {
	test(`synthetic ${source} source refuses local enforcement before any write`, async () => {
		let writes = 0;
		const h = await harness(async (_url, init) => {
			if (init.method !== "GET") writes++;
			return Response.json({
				...pullFixture,
				github: source === "github" ? {} : null,
				mergeRoute: source === "github" ? "native" : source,
			});
		});
		const target = { repoFullName: "boring/scratch", number: 1 };
		const commands: ForgeAction[] = [
			{ ...target, kind: "block", reason: "QA" },
			{ ...target, kind: "close" },
			{ ...target, kind: "lock" },
			{ ...target, kind: "label", labels: ["QA"] },
			{ ...target, kind: "post-comment", body: "QA", marker: "QA" },
			{
				...target,
				kind: "request-review",
				reviewers: ["grim"],
				teamReviewers: [],
			},
		];
		for (const command of commands)
			expect(await h.actions.execute(command, h.binding)).toEqual({
				ok: false,
				reason:
					source === "unsupported"
						? "unsupported-merge-route"
						: "upstream-managed",
			});
		expect(writes).toBe(0);
	});
}

test("upstream-managed subjects still permit reconciliation of owned cleanup", async () => {
	const h = await harness(async (url) => {
		if (url === root) return Response.json({ ...pullFixture, github: {} });
		if (url.includes("/reviews"))
			return Response.json({ ...reviewsPopulated, items: [] });
		return Response.json(commentsBefore);
	});
	for (const command of [
		{
			kind: "dismiss-review",
			repoFullName: "boring/scratch",
			number: 1,
			reviewId: null,
		},
		{ kind: "delete-comment", repoFullName: "boring/scratch", number: 1 },
	] satisfies ForgeAction[])
		expect(await h.actions.execute(command, h.binding)).toEqual({
			ok: true,
			value: { externalId: null },
		});
});

for (const source of ["github", "provider", "unsupported"] as const) {
	for (const kind of ["close", "lock"] as const) {
		test(`synthetic ${source} transition on the fresh ${kind} read refuses without writing`, async () => {
			let reads = 0;
			let writes = 0;
			const h = await harness(async (url, init) => {
				if (init.method !== "GET") writes++;
				if (url === root) {
					reads++;
					return Response.json(
						reads === 1
							? pullFixture
							: {
									...pullFixture,
									version: pullFixture.version + 1,
									github: source === "github" ? {} : null,
									mergeRoute: source === "github" ? "native" : source,
								},
					);
				}
				throw new Error("Unexpected synthetic source transition request");
			});
			expect(
				await h.actions.execute(
					{ kind, repoFullName: "boring/scratch", number: 1 },
					h.binding,
				),
			).toEqual({
				ok: false,
				reason:
					source === "unsupported"
						? "unsupported-merge-route"
						: "upstream-managed",
			});
			expect(reads).toBe(2);
			expect(writes).toBe(0);
		});
	}
}

test("owned comment cleanup still deletes after an upstream source transition", async () => {
	let deleted = false;
	const h = await harness(async (url, init) => {
		if (url === root)
			return Response.json({
				...pullFixture,
				github: {},
				mergeRoute: "provider",
			});
		if (init.method === "DELETE") {
			expect(JSON.parse(String(init.body))).toEqual({
				expectedVersion: commentCreated.version,
			});
			deleted = true;
			return new Response(null, { status: 204 });
		}
		return Response.json({
			...commentsPopulated,
			items: deleted
				? []
				: [
						{
							...commentCreated,
							body: COMMENT_MARKER,
							capabilities: { edit: true, delete: true },
						},
					],
		});
	});
	expect(
		await h.actions.execute(
			{ kind: "delete-comment", repoFullName: "boring/scratch", number: 1 },
			h.binding,
		),
	).toEqual({
		ok: true,
		value: { externalId: commentCreated.id },
	});
	expect(deleted).toBe(true);
});

test("genuine installed comment and review captures retain ownership, head and dismissal", () => {
	const comment = gitCafeActionCommentSchema.parse(commentCreated);
	const comments = gitCafeActionCommentPageSchema.parse(commentsPopulated);
	expect(
		comments.items.find((item) => item.id === comment.id)?.authorActorId,
	).toBe(installation.bot.actorId);
	const created = gitCafeActionCreatedReviewSchema.parse(reviewCreated);
	const read = gitCafeActionReviewSchema.parse(reviewReadback);
	expect(created.author.actorId).toBe(installation.bot.actorId);
	expect(read.authorViaInstallationId).toBe(installation.id);
	expect(read.id).toBe(created.id);
	expect(read.commitOid).toBe(created.commitOid);
	expect(
		gitCafeActionReviewPageSchema.parse(reviewsPopulated).items,
	).toContainEqual(read);
	expect(
		gitCafeActionReviewSchema.parse(reviewDismissed).dismissedAt,
	).not.toBeNull();
	expect(comment.capabilities).toEqual({ edit: true, delete: false });
	expect(
		gitCafeActionCommentSchema.parse(commentEdited).version,
	).toBeGreaterThan(comment.version);
	expect(deletionRefused.status).toBe(403);
	expect(dismissal.id).toBe(read.id);
	expect(dismissal.dismissedByViaInstallationId).toBe(installation.id);
	expect(gitCafeActionLabelPageSchema.parse(labelsFixture).items).toEqual([]);
	expect(gitCafeActionReviewerPageSchema.parse(reviewersFixture).items).toEqual(
		[],
	);
	expect(
		gitCafeActionReviewerPageSchema.parse(candidatesFixture).items.length,
	).toBeGreaterThan(0);
});

for (const accepted of [true, false]) {
	test(`ambiguous comment create ${accepted ? "recovers its owned receipt" : "does not dispatch blindly again"}`, async () => {
		let posted = 0;
		let body: string | undefined;
		const h = await harness(async (url, init) => {
			if (url === root) return Response.json(pullFixture);
			if (init.method === "GET" && url.startsWith(`${root}/comments/`))
				return Response.json(
					body && accepted
						? { ...commentsPopulated, items: [{ ...commentCreated, body }] }
						: commentsBefore,
				);
			if (init.method === "POST" && url === `${root}/comments/`) {
				posted++;
				body = gitCafeActionCommentWriteSchema.parse(
					JSON.parse(String(init.body)),
				).body;
				throw new Error("Synthetic response loss after dispatch");
			}
			throw new Error("Unexpected local action request");
		});
		const action = {
			kind: "comment" as const,
			repoFullName: "boring/scratch",
			number: 1,
			body: `staging verdict\n${COMMENT_MARKER}`,
			verdict: "block" as const,
			previousVerdict: null,
		};
		expect(await h.actions.execute(action, h.binding)).toMatchObject({
			ok: false,
			reason: "network",
		});
		expect(h.operation()?.dispatched).toBe(true);
		expect(await h.actions.execute(action, h.binding)).toEqual(
			accepted
				? { ok: true, value: { externalId: commentCreated.id } }
				: { ok: false, reason: "uncertain" },
		);
		expect(posted).toBe(1);
	});
}

test("observed delete refusal never becomes a successful receipt", async () => {
	let writes = 0;
	const h = await harness(async (url, init) => {
		if (init.method !== "GET") writes++;
		return Response.json(
			url === root
				? pullFixture
				: {
						...commentsPopulated,
						items: [{ ...commentCreated, body: COMMENT_MARKER }],
					},
		);
	});
	expect(
		await h.actions.execute(
			{ kind: "delete-comment", repoFullName: "boring/scratch", number: 1 },
			h.binding,
		),
	).toEqual({ ok: false, reason: "permission" });
	expect(writes).toBe(0);
});

test("a healthy same-head blocking review is reused without another submission", async () => {
	let writes = 0;
	const h = await harness(async (url, init) => {
		if (init.method !== "GET") writes++;
		return Response.json(url === root ? pullFixture : reviewsPopulated);
	});
	expect(
		await h.actions.execute(
			{
				kind: "block",
				repoFullName: "boring/scratch",
				number: 1,
				reason: reviewReadback.body,
			},
			h.binding,
		),
	).toEqual({ ok: true, value: { externalId: reviewReadback.id } });
	expect(writes).toBe(0);
});

test("review creation persists the exact replay input before dispatch", async () => {
	let posted = 0;
	const h = await harness(async (url, init) => {
		if (url === root) return Response.json(pullFixture);
		if (init.method === "GET" && url.includes(`/reviews/${reviewReadback.id}`))
			return Response.json(reviewReadback);
		if (init.method === "GET")
			return Response.json({ ...reviewsPopulated, items: [] });
		posted++;
		const persisted = h.operation();
		if (persisted?.command.kind !== "review")
			throw new Error("Missing persisted review command");
		expect(JSON.parse(String(init.body))).toEqual(persisted.command.input);
		return Response.json(reviewCreated);
	});
	expect(
		await h.actions.execute(
			{
				kind: "block",
				repoFullName: "boring/scratch",
				number: 1,
				reason: reviewReadback.body,
			},
			h.binding,
		),
	).toEqual({ ok: true, value: { externalId: reviewReadback.id } });
	expect(posted).toBe(1);
	expect(h.operation()?.command).toMatchObject({
		kind: "review",
		input: {
			requestId: h.binding.actionId,
			expectedVersion: pull.version,
			commitOid: pull.headOid,
		},
	});
});

test("a stale head prevents all writes", async () => {
	let writes = 0;
	const h = await harness(async (_url, init) => {
		if (init.method !== "GET") writes++;
		return Response.json({ ...pullFixture, headOid: "f".repeat(40) });
	});
	expect(
		await h.actions.execute(
			{
				kind: "block",
				repoFullName: "boring/scratch",
				number: 1,
				reason: "stale",
			},
			h.binding,
		),
	).toEqual({ ok: false, reason: "stale" });
	expect(writes).toBe(0);
});

for (const status of [403, 409, 429, 500]) {
	test(`review HTTP ${status} ${status === 500 ? "retains uncertainty" : "does not strand a refused submission"}`, async () => {
		const h = await harness(async (url, init) => {
			if (url === root) return Response.json(pullFixture);
			if (init.method === "GET")
				return Response.json({ items: [], next: null });
			return new Response(null, { status });
		});
		const result = await h.actions.execute(
			{
				kind: "block",
				repoFullName: "boring/scratch",
				number: 1,
				reason: reviewReadback.body,
			},
			h.binding,
		);
		expect(result.ok).toBe(false);
		expect(h.operation()?.dispatched).toBe(status === 500);
		expect(h.operation()?.reviewReceipt).toBeNull();
	});
}

for (const remove of [false, true]) {
	test(`label ${remove ? "subtraction" : "union"} preserves unrelated labels and verifies readback`, async () => {
		const unrelated = { id: "label_human", name: "human" };
		const requested = { id: "label_tripwire", name: "tripwire" };
		let current = remove ? [unrelated, requested] : [unrelated];
		const h = await harness(async (url, init) => {
			if (url === root) return Response.json(pullFixture);
			if (init.method === "PUT") {
				const command = gitCafeActionLabelInputSchema.parse(
					JSON.parse(String(init.body)),
				);
				expect(command.expectedVersion).toBe(pull.version);
				current = [unrelated, requested].filter((label) =>
					command.labelIds.includes(label.id),
				);
				return Response.json({ version: 1, items: current });
			}
			return Response.json({
				items: url.startsWith(`${root}/labels`)
					? current
					: [unrelated, requested],
				next: null,
			});
		});
		expect(
			await h.actions.execute(
				{
					kind: remove ? "remove-label" : "label",
					repoFullName: "boring/scratch",
					number: 1,
					labels: ["tripwire"],
				},
				h.binding,
			),
		).toEqual({ ok: true, value: { externalId: null } });
		expect(current).toEqual(remove ? [unrelated] : [unrelated, requested]);
	});
}

test("an exact reviewer ID cannot fall back to another actor's matching handle", async () => {
	const original = candidatesFixture.items[0];
	if (!original) throw new Error("Missing captured candidate");
	let writes = 0;
	const h = await harness(async (url, init) => {
		if (url === root) return Response.json(pullFixture);
		if (init.method === "PUT") writes++;
		return Response.json({
			items: url.includes("reviewer-candidates")
				? [
						{
							...original,
							id: "act_synthetic_replacement",
							handle: original.id,
						},
					]
				: [],
			next: null,
		});
	});
	expect(
		await h.actions.execute(
			{
				kind: "request-review",
				repoFullName: "boring/scratch",
				number: 1,
				reviewers: [],
				reviewerIds: [original.id],
				teamReviewers: [],
			},
			h.binding,
		),
	).toEqual({ ok: false, reason: "target-unavailable" });
	expect(writes).toBe(0);
});

test("exact reviewer IDs survive renames and preserve unrelated human requests", async () => {
	const original = candidatesFixture.items[0];
	if (!original) throw new Error("Missing captured candidate");
	const renamed = { ...original, handle: "synthetic_new_handle" };
	const unrelated = { id: "act_synthetic_existing", handle: "existing" };
	let current = [unrelated];
	const h = await harness(async (url, init) => {
		if (url === root) return Response.json(pullFixture);
		if (init.method === "PUT") {
			const input = gitCafeActionReviewerInputSchema.parse(
				JSON.parse(String(init.body)),
			);
			expect(input.actorIds).toEqual([unrelated.id, original.id]);
			current = [unrelated, renamed];
			return Response.json({ version: 1, items: current });
		}
		return Response.json({
			items: url.includes("reviewer-candidates") ? [renamed] : current,
			next: null,
		});
	});
	expect(
		await h.actions.execute(
			{
				kind: "request-review",
				repoFullName: "boring/scratch",
				number: 1,
				reviewers: [],
				reviewerIds: [original.id],
				teamReviewers: [],
			},
			h.binding,
		),
	).toEqual({ ok: true, value: { externalId: null } });
});

test("reviewer union retains human requests and resolves stable candidate IDs", async () => {
	const candidates =
		gitCafeActionReviewerPageSchema.parse(candidatesFixture).items;
	const added = candidates[0];
	if (!added) throw new Error("Missing captured candidate");
	const unrelated = { id: "act_existing_human", handle: "existing" };
	let current: typeof candidates = [unrelated];
	const h = await harness(async (url, init) => {
		if (url === root) return Response.json(pullFixture);
		if (init.method === "PUT") {
			const command = gitCafeActionReviewerInputSchema.parse(
				JSON.parse(String(init.body)),
			);
			expect(command.actorIds).toEqual([unrelated.id, added.id]);
			current = [unrelated, added];
			return Response.json({ version: 1, items: current });
		}
		return Response.json({
			items: url.includes("reviewer-candidates") ? candidates : current,
			next: null,
		});
	});
	expect(
		await h.actions.execute(
			{
				kind: "request-review",
				repoFullName: "boring/scratch",
				number: 1,
				reviewers: [added.id],
				teamReviewers: [],
			},
			h.binding,
		),
	).toEqual({ ok: true, value: { externalId: null } });
});

for (const kind of ["close", "lock"] as const) {
	test(`${kind} uses a fresh subject version and checks resulting state`, async () => {
		let subject = gitCafeActionSubjectSchema.parse(pullFixture);
		let writes = 0;
		const h = await harness(async (url, init) => {
			if (init.method === "GET") return Response.json(subject);
			expect(url).toBe(`${root}/${kind}`);
			expect(init.method).toBe("POST");
			const input: unknown = JSON.parse(String(init.body));
			expect(input).toMatchObject({ expectedVersion: subject.version });
			if (kind === "lock") expect(input).toMatchObject({ reason: "off_topic" });
			writes++;
			subject = {
				...subject,
				version: subject.version + 1,
				state: kind === "close" ? "closed" : subject.state,
				lockedAt: kind === "lock" ? new Date().toISOString() : subject.lockedAt,
			};
			return Response.json(subject);
		});
		expect(
			await h.actions.execute(
				{ kind, repoFullName: "boring/scratch", number: 1 },
				h.binding,
			),
		).toEqual({ ok: true, value: { externalId: pull.id } });
		expect(writes).toBe(1);
	});
}

test("deletion never trusts another author's marker or claims a refused deletion succeeded", async () => {
	let writes = 0;
	for (const own of [true, false]) {
		const h = await harness(async (url, init) => {
			if (url === root) return Response.json(pullFixture);
			if (init.method !== "GET") writes++;
			return Response.json({
				items: [
					{
						...commentCreated,
						authorActorId: own ? installation.bot.actorId : "act_someone_else",
						body: COMMENT_MARKER,
					},
				],
				next: null,
			});
		});
		expect(
			await h.actions.execute(
				{ kind: "delete-comment", repoFullName: "boring/scratch", number: 1 },
				h.binding,
			),
		).toEqual(
			own
				? { ok: false, reason: "permission" }
				: { ok: true, value: { externalId: null } },
		);
	}
	expect(writes).toBe(0);
});

test("an issue comment deletion accepts a 204 and still requires complete readback", async () => {
	let deleted = false;
	const issueRoot = root.replace("/pulls/", "/issues/");
	const h = await harness(async (url, init) => {
		if (url === issueRoot)
			return Response.json({
				...pullFixture,
				headOid: null,
				stateType: "started",
			});
		if (init.method === "DELETE") {
			deleted = true;
			return new Response(null, { status: 204 });
		}
		return Response.json({
			items: deleted
				? []
				: [
						{
							...commentCreated,
							body: COMMENT_MARKER,
							capabilities: { edit: true, delete: true },
						},
					],
			next: null,
		});
	});
	expect(
		await h.actions.execute(
			{ kind: "delete-comment", repoFullName: "boring/scratch", number: 1 },
			{ ...h.binding, subject: "issue", headOid: null },
		),
	).toEqual({ ok: true, value: { externalId: commentCreated.id } });
});

for (const status of [403, 429, 500]) {
	test(`comment transport ${status} ${status === 500 ? "retains uncertainty" : "permits retry after a definitive refusal"}`, async () => {
		let posts = 0;
		const h = await harness(async (url, init) => {
			if (url === root) return Response.json(pullFixture);
			if (init.method === "GET") return Response.json(commentsBefore);
			posts++;
			if (posts === 1) return new Response(null, { status });
			const input = gitCafeActionCommentWriteSchema.parse(
				JSON.parse(String(init.body)),
			);
			return Response.json({ ...commentCreated, body: input.body });
		});
		const action = {
			kind: "post-comment" as const,
			repoFullName: "boring/scratch",
			number: 1,
			body: "Local retry probe",
			marker: "<!-- local-retry-probe -->",
		};
		expect(await h.actions.execute(action, h.binding)).toEqual({
			ok: false,
			reason: "http",
			status,
		});
		expect(await h.actions.execute(action, h.binding)).toEqual(
			status === 500
				? { ok: false, reason: "uncertain" }
				: { ok: true, value: { externalId: commentCreated.id } },
		);
		expect(posts).toBe(status === 500 ? 1 : 2);
	});
}

test("a lost supersession response retains the replacement intent when the active marker has disappeared", async () => {
	let old = { ...commentCreated, body: `Old verdict ${COMMENT_MARKER}` };
	let posts = 0;
	const replacementId = `prcomment_${generateId()}`;
	const h = await harness(async (url, init) => {
		if (url === root) return Response.json(pullFixture);
		if (init.method === "GET")
			return Response.json({ items: [old], next: null });
		const input = gitCafeActionCommentWriteSchema.parse(
			JSON.parse(String(init.body)),
		);
		if (init.method === "PATCH") {
			old = { ...old, body: input.body, version: old.version + 1 };
			throw new Error("Local lost edit response");
		}
		posts++;
		return Response.json({
			...commentCreated,
			id: replacementId,
			body: input.body,
		});
	});
	const action = {
		kind: "comment" as const,
		repoFullName: "boring/scratch",
		number: 1,
		body: `New verdict ${COMMENT_MARKER}`,
		previousVerdict: "block" as const,
		verdict: "pass" as const,
		onlyIfPresent: true,
	};
	expect(await h.actions.execute(action, h.binding)).toEqual({
		ok: false,
		reason: "network",
	});
	expect(old.body).not.toContain(COMMENT_MARKER);
	expect(await h.actions.execute(action, h.binding)).toEqual({
		ok: true,
		value: { externalId: replacementId },
	});
	expect(posts).toBe(1);
});
