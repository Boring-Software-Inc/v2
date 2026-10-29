import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	type GitCafeActionOperation,
	type GitCafeCheckRerequestedEvent,
	type GitCafeDispatchableRepositoryEvent,
	gitCafeActionOperationSchema,
	gitCafeActionPayloadSchema,
	gitCafeCheckRerequestedEventSchema,
	gitCafeCommentEventSchema,
	gitCafeInstallationSchema,
	gitCafePullEventSchema,
	gitCafePullIdentitySchema,
	gitCafeReadPullSchema,
	gitCafeReceiptSchema,
	normalizedEventSchema,
	responseConfigSchema,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { deriveDefaultWorkflow } from "@tripwire/core";
import {
	applyMigrations,
	createBoss,
	createDb,
	createGitCafeConnectionBoss,
	createTestDatabase,
	eventServices,
	gitCafeActionServices,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	moderationServices,
	organization,
	organizationInstallations,
	repoServices,
	repos,
	runServices,
	type TestDatabase,
	workflowDefinitions,
	workflowServices,
} from "@tripwire/db";
import { normalizeGitCafePullEvent } from "@tripwire/forge-gitcafe";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { registerGitCafeProtectionQueues } from "./gitcafe-protection-worker.ts";
import { buildGitCafeRuntime } from "./gitcafe-runtime.ts";
import {
	emitClosedReviewSurfaces,
	emitPrSurface,
	recoverGitCafeRunSurface,
	toForgeAction,
} from "./jobs/pr-surface.ts";
import { processEvent } from "./jobs/process-event.ts";
import { refreshRepoSurfaces } from "./jobs/refresh-surfaces.ts";
import { rerunChangeRequest } from "./jobs/rerun.ts";
import { resumeRun } from "./jobs/resume-run.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

const base = new URL(
	"../../../packages/forge-gitcafe/fixtures/",
	import.meta.url,
);
const installation = gitCafeInstallationSchema.parse(
	await Bun.file(
		new URL("gitcafe-action-installation-current.json", base),
	).json(),
);
const event = gitCafePullEventSchema.parse(
	await Bun.file(new URL("gitcafe-pull-created-webhook.json", base)).json(),
);
let container: TestDatabase;
let database: ReturnType<typeof createDb>;
let boss: Awaited<ReturnType<typeof createBoss>>;
let actionId: string;
let repoId: string;
let operation: GitCafeActionOperation;

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
	boss = await createBoss(container.url);
	await boss.createQueue(GITCAFE_LIFECYCLE_QUEUE);
	await boss.createQueue(GITCAFE_PROCESS_EVENT_QUEUE);
}, 120_000);

beforeEach(async () => {
	await database.db.execute(
		sql`TRUNCATE events, repos, organization, gitcafe_installation_lifecycle CASCADE`,
	);
	const orgId = generateId();
	repoId = generateId();
	await database.db.insert(organization).values({
		id: orgId,
		name: "Action authority test",
		slug: `action-${orgId}`,
	});
	await database.db.insert(organizationInstallations).values({
		id: generateId(),
		forge: "gitcafe",
		installationId: installation.id,
		organizationId: orgId,
		accountLogin: installation.org,
	});
	await database.db.insert(repos).values({
		id: repoId,
		forge: "gitcafe",
		externalId: event.repository.id,
		owner: event.repository.owner,
		name: event.repository.name,
		fullName: `${event.repository.owner}/${event.repository.name}`,
		installationId: installation.id,
		orgId,
		armed: true,
	});
	await database.db.insert(gitCafeInstallationLifecycle).values({
		installationId: installation.id,
		status: "active",
		generation: 1,
		authorityAt: new Date(),
	});
	if (event.pull.authorActorId === null)
		throw new Error("Captured PR author is unavailable");
	const normalized = normalizeGitCafePullEvent(
		{ event, author: { login: "grim", externalId: event.pull.authorActorId } },
		new Date().toISOString(),
	);
	if (!normalized || !("changeRequest" in normalized))
		throw new Error("Expected captured PR");
	const inserted = await eventServices.insertRawEvent(database.pool, boss, {
		deliveryId: normalized.deliveryId,
		forge: "gitcafe",
		rawKind: event.type,
		raw: event,
	});
	if (!inserted.eventId) throw new Error("Event was not inserted");
	await eventServices.markEventNormalized(
		database.db,
		database.pool,
		inserted.eventId,
		normalized,
	);
	const runId = await runServices.createRun(database.db, {
		eventId: inserted.eventId,
		repoFullName: normalized.repo.fullName,
		subjectNumber: event.pull.number,
		headSha: normalized.changeRequest.headSha,
		snapshot: [deriveDefaultWorkflow([])],
		status: "completed",
		verdict: "block",
	});
	const [action] = await runServices.recordActions(database.db, runId, [
		{
			kind: "comment",
			payload: { body: "recorded body" },
			idempotencyKey: "comment",
		},
	]);
	if (!action) throw new Error("Action was not recorded");
	actionId = action.id;
	const binding = await gitCafeActionServices.getGitCafeActionBinding(
		database.db,
		actionId,
	);
	if (!binding) throw new Error("Expected current claimed action");
	operation = gitCafeActionOperationSchema.parse({
		...binding,
		format: "gitcafe-action@1",
		dispatched: false,
		command: { kind: "comment", body: "recorded body" },
	});
});

afterAll(async () => {
	await boss?.stop({ graceful: false, close: true });
	await database?.pool.end();
	await container?.stop();
});

test("resume settlement rolls back its audit on failure and concurrent retries apply one decision", async () => {
	const binding = await gitCafeActionServices.getGitCafeActionBinding(
		database.db,
		actionId,
	);
	if (!binding) throw new Error("Missing bound action");
	const [row] = (
		await database.pool.query<{ run_id: string }>(
			"SELECT run_id FROM run_actions WHERE id=$1",
			[actionId],
		)
	).rows;
	if (!row) throw new Error("Missing bound run");
	await runServices.pauseRun(database.db, row.run_id);
	const itemId = await moderationServices.createModerationItem(database.db, {
		runId: row.run_id,
		nodeId: "run:degraded",
	});
	await database.pool.query(
		"UPDATE moderation_items SET status='approved' WHERE id=$1",
		[itemId],
	);
	const now = new Date().toISOString();
	const input = {
		runId: row.run_id,
		itemId,
		decision: "approve" as const,
		steps: [
			{
				nodeId: "decision:resume",
				nodeKind: "gate",
				status: "pass",
				input: { decision: "approve" },
				output: null,
				startedAt: now,
				finishedAt: now,
				durationMs: 0,
			},
		],
		actions: [{ kind: "note", payload: {}, idempotencyKey: "decision-note" }],
		moderationNodeIds: [],
	};
	await database.pool.query(
		"CREATE FUNCTION fail_resume_settle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'resume settle outage'; END IF; RETURN NEW; END $$",
	);
	await database.pool.query(
		"CREATE TRIGGER fail_resume_settle BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION fail_resume_settle()",
	);
	try {
		await expect(
			runServices.persistRunResume(database.db, input),
		).rejects.toMatchObject({ cause: { message: "resume settle outage" } });
	} finally {
		await database.pool.query("DROP TRIGGER fail_resume_settle ON runs");
		await database.pool.query("DROP FUNCTION fail_resume_settle()");
	}
	expect(
		(await runServices.getRunWithSteps(database.db, row.run_id))?.steps,
	).toHaveLength(0);
	expect(
		(await moderationServices.getModerationItem(database.db, itemId))
			?.appliedAt,
	).toBeNull();
	await Promise.all(
		Array.from({ length: 3 }, () =>
			runServices.persistRunResume(database.db, input),
		),
	);
	const saved = await runServices.getRunWithSteps(database.db, row.run_id);
	expect(saved?.steps).toHaveLength(1);
	expect(
		saved?.actions.filter((action) => action.kind === "note"),
	).toHaveLength(1);
	expect(saved?.run.verdict).toBe("pass");
	expect(
		(await moderationServices.getModerationItem(database.db, itemId))
			?.appliedAt,
	).not.toBeNull();
});

test("a still-required close gets a new phase intent without rewriting its predecessor", async () => {
	const [source] = (
		await database.pool.query<{ run_id: string }>(
			"SELECT run_id FROM run_actions WHERE id=$1",
			[actionId],
		)
	).rows;
	if (!source) throw new Error("Missing source run");
	await runServices.pauseRun(database.db, source.run_id);
	const [close] = await runServices.recordActions(database.db, source.run_id, [
		{
			kind: "close",
			payload: { nodeId: "close" },
			idempotencyKey: "close-origin",
		},
	]);
	if (!close) throw new Error("Missing close intent");
	const origin = gitCafeActionPayloadSchema.parse(close.payload).gitCafePhase;
	const itemId = await moderationServices.createModerationItem(database.db, {
		runId: source.run_id,
		nodeId: "run:degraded",
	});
	await database.pool.query(
		"UPDATE moderation_items SET status='approved' WHERE id=$1",
		[itemId],
	);
	await runServices.persistRunResume(database.db, {
		runId: source.run_id,
		itemId,
		decision: "approve",
		steps: [],
		actions: [],
		moderationNodeIds: [],
	});
	const phase = await runServices.getGitCafeEvaluationPhase(
		database.db,
		source.run_id,
	);
	if (!phase) throw new Error("Missing settled phase");
	expect(phase.verdict).toBe("close");
	const continued = await runServices.recordGitCafeSurfaceActions(
		database.db,
		source.run_id,
		phase,
		[],
		[close.id],
		[],
	);
	expect(continued).toHaveLength(1);
	expect(continued?.[0]?.kind).toBe("close");
	expect(
		gitCafeActionPayloadSchema.parse(continued?.[0]?.payload).gitCafePhase,
	).toEqual(phase);
	const saved = await runServices.getRunWithSteps(database.db, source.run_id);
	const old = saved?.actions.find((action) => action.id === close.id);
	expect(old?.status).toBe("superseded");
	expect(gitCafeActionPayloadSchema.parse(old?.payload).gitCafePhase).toEqual(
		origin,
	);
	expect(
		await runServices.recordGitCafeSurfaceActions(
			database.db,
			source.run_id,
			phase,
			[],
			[close.id],
			[],
		),
	).toHaveLength(0);
});

test("concurrent create claims permit one dispatch and preserve the first command", async () => {
	expect(
		await gitCafeActionServices.prepareGitCafeAction(database.db, operation),
	).toEqual(operation);
	expect(
		await gitCafeActionServices.prepareGitCafeAction(database.db, {
			...operation,
			command: { kind: "comment", body: "changed during retry" },
		}),
	).toEqual(operation);
	const claimed = await Promise.all(
		Array.from({ length: 12 }, () =>
			gitCafeActionServices.claimGitCafeComment(database.db, actionId),
		),
	);
	expect(claimed.filter(Boolean)).toHaveLength(1);
	expect(
		(await gitCafeActionServices.prepareGitCafeAction(database.db, operation))
			?.dispatched,
	).toBe(true);
});

test("disarming before preparation refuses the command", async () => {
	await database.db
		.update(repos)
		.set({ armed: false })
		.where(eq(repos.id, repoId));
	expect(
		await gitCafeActionServices.getGitCafeActionBinding(database.db, actionId),
	).toBeNull();
	expect(
		await gitCafeActionServices.prepareGitCafeAction(database.db, operation),
	).toBeNull();
});

test("lifecycle revocation between preparation and dispatch refuses the claim", async () => {
	await gitCafeActionServices.prepareGitCafeAction(database.db, operation);
	await database.db
		.update(gitCafeInstallationLifecycle)
		.set({ status: "paused", generation: 2 })
		.where(eq(gitCafeInstallationLifecycle.installationId, installation.id));
	expect(
		await gitCafeActionServices.claimGitCafeComment(database.db, actionId),
	).toBe(false);
});

test("a claimed installation cannot authorize another repository identity", async () => {
	expect(
		await gitCafeActionServices.prepareGitCafeAction(database.db, {
			...operation,
			repositoryId: "repo_other",
		}),
	).toBeNull();
	expect(
		await gitCafeActionServices.prepareGitCafeAction(database.db, {
			...operation,
			installationId: "ins_other",
		}),
	).toBeNull();
	expect(
		await gitCafeActionServices.claimGitCafeComment(database.db, actionId),
	).toBe(false);
});

test("a recorded comment command cannot authorize close or another payload", async () => {
	const { gitCafeInstallationTokenSchema, gitCafeActionSubjectSchema } =
		await import("@tripwire/contracts");
	const token = gitCafeInstallationTokenSchema.parse(
		await Bun.file(new URL("gitcafe-action-token-current.json", base)).json(),
	);
	const pull = gitCafeActionSubjectSchema.parse(
		await Bun.file(new URL("gitcafe-read-scratch-pull.json", base)).json(),
	);
	const repository: unknown = await Bun.file(
		new URL("gitcafe-connection-repository.json", base),
	).json();
	let writes = 0;
	const runtime = buildGitCafeRuntime(
		database.db,
		{
			appId: installation.appId,
			keyId: "local-binding-test",
			privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
				.privateKey.export({ format: "pem", type: "pkcs8" })
				.toString(),
		},
		async (url, init) => {
			if (url.includes("/api/apps/"))
				return Response.json(
					init.method === "GET"
						? installation
						: {
								...token,
								token: "local-binding-token",
								expiresAt: new Date(Date.now() + 900000).toISOString(),
							},
				);
			if (new URL(url).pathname === "/api/repos/boring/scratch")
				return Response.json(repository);
			if (init.method !== "GET") writes++;
			return Response.json({ ...pull, state: writes ? "closed" : "open" });
		},
	);
	if (!runtime.adapter) throw new Error("Missing adapter");
	expect(
		await runtime.adapter.execute(
			{ kind: "close", repoFullName: "boring/scratch", number: 1 },
			{ actionId },
		),
	).toEqual({ refused: true, reason: "command-mismatch" });
	expect(
		await runtime.adapter.execute(
			{
				kind: "comment",
				repoFullName: "boring/scratch",
				number: 1,
				body: "different body",
				verdict: "pass",
				previousVerdict: null,
			},
			{ actionId },
		),
	).toEqual({ refused: true, reason: "command-mismatch" });
	expect(writes).toBe(0);
});

async function admitPullReceipt(
	source:
		| GitCafeDispatchableRepositoryEvent
		| GitCafeCheckRerequestedEvent = event,
) {
	const payload = { ...source, id: `evt_${generateId()}` };
	const body = JSON.stringify(payload);
	const receipt = gitCafeReceiptSchema.parse({
		format: "gitcafe-receipt@1",
		appId: GITCAFE_RECEIPT_APP_ID,
		payload,
		bodyBase64: Buffer.from(body).toString("base64"),
		bodySha256: createHash("sha256").update(body).digest("hex"),
		deliveryId: generateId(),
		keyVersion: "test",
		signedAt: String(Math.floor(Date.now() / 1000)),
		requestId: generateId(),
	});
	const inserted = await gitCafeLifecycleServices.insertGitCafeReceipt(
		database.pool,
		boss,
		receipt,
	);
	return { ...inserted, receipt, payload };
}

const COMMENT_SCENARIOS = [
	"healthy",
	"self",
	"edited",
	"deleted",
	"unchanged-retry",
] as const;
for (const kind of ["pull", "issue"] as const) {
	const scenarios: Array<
		| (typeof COMMENT_SCENARIOS)[number]
		| "block"
		| "block-outage"
		| "block-head-change"
		| "thread-head-change"
	> = [...COMMENT_SCENARIOS];
	if (kind === "pull")
		scenarios.push(
			"block",
			"block-outage",
			"block-head-change",
			"thread-head-change",
		);
	for (const scenario of scenarios) {
		test(`signed ${kind} comment across ${scenario}`, async () => {
			const self = scenario === "self";
			const blocking = scenario.startsWith("block");
			const fixture = (name: string): Promise<unknown> =>
				Bun.file(new URL(`${name}.json`, base)).json();
			const [
				raw,
				subjectRead,
				detailRead,
				issuePage,
				repository,
				token,
				profile,
				members,
				collaborators,
				merged,
			] = await Promise.all([
				fixture(`gitcafe-${kind}-comment-created-webhook`),
				fixture(
					kind === "pull" ? "gitcafe-read-scratch-pull" : "gitcafe-read-issue",
				),
				fixture("gitcafe-read-pull-comment-detail"),
				fixture("gitcafe-read-issue-comments"),
				fixture("gitcafe-connection-repository"),
				fixture("gitcafe-action-token-current"),
				fixture("gitcafe-read-profile"),
				fixture("gitcafe-connection-members"),
				fixture("gitcafe-read-collaborators"),
				fixture("gitcafe-read-pulls"),
			]);
			const {
				gitCafeActionSubjectSchema,
				gitCafeCommentSubjectSchema,
				gitCafeCommentDetailSchema,
				gitCafeIssueCommentPageSchema,
				gitCafeInstallationTokenSchema,
			} = await import("@tripwire/contracts");
			const captured = gitCafeCommentEventSchema.parse(raw);
			const author = self
				? installation.bot.actorId
				: captured.comment.authorActorId;
			const source = gitCafeCommentEventSchema.parse({
				...captured,
				actor: { id: author },
				comment: { ...captured.comment, authorActorId: author },
			});
			let subject = {
				...gitCafeActionSubjectSchema.parse(subjectRead),
				...gitCafeCommentSubjectSchema.parse(subjectRead),
			};
			const detail = gitCafeCommentDetailSchema.parse(detailRead);
			const comments = gitCafeIssueCommentPageSchema.parse(issuePage);
			const tokenData = gitCafeInstallationTokenSchema.parse(token);
			const target = `/api/repos/boring/scratch/${kind === "pull" ? "pulls/1" : "issues/2"}`;
			const writes: string[] = [];
			let lockOutage = true;
			let closeOutage = scenario === "thread-head-change";
			let changed = false;
			let reviewAttempts = 0;
			let reviewPosted = false;
			let reviewBody = "";
			const reviewRead = await fixture("gitcafe-action-review-readback");
			const reviewCreated = await fixture("gitcafe-action-review-created");
			const {
				gitCafeActionReviewSchema,
				gitCafeActionCreatedReviewSchema,
				gitCafeActionReviewCreateSchema,
			} = await import("@tripwire/contracts");
			const reviewData = gitCafeActionReviewSchema.parse(reviewRead);
			const createdData = gitCafeActionCreatedReviewSchema.parse(reviewCreated);
			const reviewCommands: string[] = [];
			const runtime = buildGitCafeRuntime(
				database.db,
				{
					appId: installation.appId,
					keyId: "local-comment-test",
					privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
						.privateKey.export({ format: "pem", type: "pkcs8" })
						.toString(),
				},
				async (url, init) => {
					const path = new URL(url).pathname;
					if (path.includes("/api/apps/"))
						return Response.json(
							init.method === "GET"
								? installation
								: {
										...tokenData,
										token: "local-comment-token",
										expiresAt: new Date(Date.now() + 900_000).toISOString(),
									},
						);
					if (path === "/api/repos/boring/scratch")
						return Response.json(repository);
					if (path === target) return Response.json(subject);
					if (path === `${target}/reviews`) {
						if (init.method === "POST") {
							reviewAttempts++;
							const command = gitCafeActionReviewCreateSchema.parse(
								JSON.parse(String(init.body)),
							);
							reviewCommands.push(JSON.stringify(command));
							expect(command.commitOid).toBe(reviewData.commitOid);
							if (scenario !== "block" && reviewAttempts === 1)
								return new Response(null, { status: 503 });
							reviewPosted = true;
							reviewBody = command.body;
							return Response.json(createdData);
						}
						return Response.json({
							items: reviewPosted ? [{ ...reviewData, body: reviewBody }] : [],
							next: null,
						});
					}
					if (path === `${target}/reviews/${reviewData.id}`)
						return Response.json({ ...reviewData, body: reviewBody });
					if (path.endsWith("/detail"))
						return Response.json({
							...detail,
							body:
								changed && scenario === "edited"
									? "edited after normalization"
									: detail.body,
							deletedAt:
								changed && scenario === "deleted"
									? new Date().toISOString()
									: detail.deletedAt,
							authorActorId: author,
							author: {
								...detail.author,
								actorId: author,
								handle: self ? installation.bot.handle : detail.author.handle,
							},
						});
					if (path === `${target}/comments/`)
						return Response.json({
							...comments,
							items:
								changed && scenario === "deleted"
									? []
									: comments.items.map((comment) => ({
											...comment,
											body:
												changed && scenario === "edited"
													? "edited after normalization"
													: comment.body,
											authorActorId: author,
											author: {
												...comment.author,
												actorId: author,
												handle: self
													? installation.bot.handle
													: comment.author.handle,
											},
										})),
						});
					if (path === "/api/users/grim") return Response.json(profile);
					if (path === "/api/orgs/boring/members/")
						return Response.json(members);
					if (path.endsWith("/collaborators/"))
						return Response.json(collaborators);
					if (path.endsWith("/pulls/")) return Response.json(merged);
					if (path === `${target}/lock`) {
						if (lockOutage) {
							lockOutage = false;
							return new Response(null, { status: 503 });
						}
						expect(init.method).toBe(kind === "pull" ? "POST" : "PUT");
						writes.push(path);
						subject = {
							...subject,
							lockedAt: new Date().toISOString(),
							version: subject.version + 1,
						};
						return Response.json(subject);
					}
					if (path === `${target}/close`) {
						if (closeOutage) {
							closeOutage = false;
							return new Response(null, { status: 503 });
						}
						expect(init.method).toBe("POST");
						writes.push(path);
						subject = {
							...subject,
							state: "closed",
							stateType: "completed",
							version: subject.version + 1,
						};
						return Response.json(subject);
					}
					throw new Error(`Unexpected synthetic comment path: ${path}`);
				},
			);
			const definition = workflowDefinitionSchema.parse({
				id: generateId(),
				name: "Comment thread action test",
				version: 1,
				nodes: blocking
					? [
							{ id: "comment", type: "trigger", kinds: ["comment.created"] },
							{ id: "block", type: "action", action: "block", params: {} },
						]
					: [
							{ id: "comment", type: "trigger", kinds: ["comment.created"] },
							{
								id: "lock",
								type: "action",
								action: "lock",
								params: { reason: "spam" },
							},
							{ id: "close", type: "action", action: "close", params: {} },
						],
				edges: blocking
					? [{ id: "block-edge", from: "comment", to: "block" }]
					: [
							{ id: "lock-edge", from: "comment", to: "lock" },
							{ id: "close-edge", from: "comment", to: "close" },
						],
			});
			const workflow = await workflowServices.createWorkflow(database.db, {
				repoId,
				definition,
			});
			await database.db
				.update(workflowDefinitions)
				.set({ enabled: true })
				.where(eq(workflowDefinitions.id, workflow.id));
			const admitted = await admitPullReceipt(source);
			expect(
				await Promise.all(
					Array.from({ length: 4 }, () =>
						gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
							database.db,
							boss,
							admitted.receiptId,
						),
					),
				),
			).toEqual(Array(4).fill("dispatched"));
			const [row] = (
				await database.pool.query<{ id: string }>(
					"SELECT id FROM events WHERE delivery_id=$1",
					[JSON.stringify([source.installation.id, admitted.payload.id])],
				)
			).rows;
			if (!row) throw new Error("Missing dispatched comment event");
			expect(
				(
					await database.pool.query(
						"SELECT id FROM pgboss.job WHERE name=$1 AND data->>'eventId'=$2",
						[GITCAFE_PROCESS_EVENT_QUEUE, row.id],
					)
				).rowCount,
			).toBe(1);
			const deps = {
				db: database.db,
				pool: database.pool,
				logger: pino({ level: "silent" }),
				resolveForge: () => runtime,
				makeGenerate: null,
				appUrl: "https://staging.tripwire.sh",
				resumeNormalized: true,
			};
			const previous = process.env.TRIPWIRE_DISABLE_EXEMPTION;
			process.env.TRIPWIRE_DISABLE_EXEMPTION = "true";
			try {
				if (["edited", "deleted", "unchanged-retry"].includes(scenario)) {
					const original = eventServices.markEventNormalized;
					const interrupted = spyOn(
						eventServices,
						"markEventNormalized",
					).mockImplementationOnce(async (...args) => {
						await original(...args);
						throw new Error("Interrupted after comment normalization");
					});
					try {
						await expect(
							processEvent(deps, { eventId: row.id }),
						).rejects.toThrow("Interrupted after comment normalization");
					} finally {
						interrupted.mockRestore();
					}
					expect(
						(await eventServices.getEventById(database.db, row.id))
							?.normalizedAt,
					).not.toBeNull();
					expect(
						await runServices.getRunForEvent(database.db, row.id),
					).toBeNull();
					changed = true;
				}
				await processEvent(deps, { eventId: row.id });
				expect(
					(await eventServices.getEventById(database.db, row.id))?.normalized,
				).toMatchObject({
					kind: "comment.created",
					actor: { externalId: author },
					comment: { byTripwire: self },
				});
				const saved = await runServices.getRunForEvent(database.db, row.id);
				if (scenario === "edited" || scenario === "deleted") {
					expect(saved).toBeNull();
					expect(writes).toEqual([]);
					return;
				}
				if (self) {
					expect(saved).toBeNull();
					expect(writes).toEqual([]);
					return;
				}
				if (!saved) throw new Error("Missing comment run");
				if (blocking) {
					expect(saved.headSha).toBe(reviewData.commitOid);
					if (scenario === "block-head-change")
						subject = {
							...subject,
							headOid: "b".repeat(40),
							version: subject.version + 1,
						};
					await processEvent(deps, { eventId: row.id });
					await processEvent(deps, { eventId: row.id });
					const final = await runServices.getRunWithSteps(
						database.db,
						saved.id,
					);
					expect(final?.run.headSha).toBe(reviewData.commitOid);
					expect(
						final?.actions.find((action) => action.kind === "block")?.status,
					).toBe(scenario === "block-head-change" ? "recorded" : "executed");
					expect(reviewAttempts).toBe(scenario === "block-outage" ? 2 : 1);
					expect(reviewPosted).toBe(scenario !== "block-head-change");
					if (scenario === "block-outage")
						expect(reviewCommands[1]).toBe(reviewCommands[0]);
					expect(
						(await eventServices.getEventById(database.db, row.id))?.raw,
					).toEqual(admitted.payload);
					return;
				}
				const first = await runServices.getRunWithSteps(database.db, saved.id);
				expect(
					first?.actions.find((action) => action.kind === "lock")?.status,
				).toBe("recorded");
				const pendingLock = first?.actions.find(
					(action) => action.kind === "lock",
				);
				if (!pendingLock) throw new Error("Missing recorded lock");
				if (scenario === "thread-head-change") {
					expect(writes).toEqual([]);
					expect(saved.headSha).toBe(subject.headOid ?? null);
					subject = {
						...subject,
						headOid: "b".repeat(40),
						version: subject.version + 1,
					};
				}
				expect(
					(
						await gitCafeActionServices.getGitCafeActionBinding(
							database.db,
							pendingLock.id,
						)
					)?.subject,
				).toBe(kind === "pull" ? "change-request" : "issue");
				await processEvent(deps, { eventId: row.id });
				await processEvent(deps, { eventId: row.id });
				const final = await runServices.getRunWithSteps(database.db, saved.id);
				expect(final?.run.status).toBe("completed");
				expect(
					final?.actions.map((action) => [action.kind, action.status]).sort(),
				).toEqual([
					["close", "executed"],
					["lock", "executed"],
				]);
				expect(writes.sort()).toEqual([`${target}/close`, `${target}/lock`]);
				expect(
					(await eventServices.getEventById(database.db, row.id))?.raw,
				).toEqual(admitted.payload);
			} finally {
				if (previous === undefined)
					delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
				else process.env.TRIPWIRE_DISABLE_EXEMPTION = previous;
			}
		});
	}
}

test("concurrent signed receipt dispatch commits one raw event and one scoped job", async () => {
	const admitted = await admitPullReceipt();
	const results = await Promise.all(
		Array.from({ length: 8 }, () =>
			gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
				database.db,
				boss,
				admitted.receiptId,
			),
		),
	);
	expect(results).toEqual(Array(8).fill("dispatched"));
	const rows = await database.pool.query<{ id: string; raw: unknown }>(
		"SELECT id, raw FROM events WHERE forge = 'gitcafe' AND delivery_id = $1",
		[JSON.stringify([event.installation.id, admitted.payload.id])],
	);
	expect(rows.rows).toHaveLength(1);
	expect(rows.rows[0]?.raw).toEqual(admitted.payload);
	const jobs = await database.pool.query<{ data: unknown }>(
		"SELECT data FROM pgboss.job WHERE name = $1 AND data->>'eventId' = $2",
		[GITCAFE_PROCESS_EVENT_QUEUE, rows.rows[0]?.id],
	);
	expect(jobs.rows).toEqual([
		{
			data: {
				eventId: rows.rows[0]?.id,
				requestId: admitted.receipt.requestId,
			},
		},
	]);
});

test("failed atomic dispatch preserves the pending receipt and can retry without a partial event", async () => {
	const admitted = await admitPullReceipt();
	const failure = spyOn(boss, "insert").mockRejectedValueOnce(
		new Error("Local queue outage"),
	);
	try {
		await expect(
			gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
				database.db,
				boss,
				admitted.receiptId,
			),
		).rejects.toThrow("Local queue outage");
	} finally {
		failure.mockRestore();
	}
	const before = await database.pool.query(
		"SELECT id FROM events WHERE delivery_id = $1",
		[JSON.stringify([event.installation.id, admitted.payload.id])],
	);
	expect(before.rowCount).toBe(0);
	const receipt = await database.pool.query<{ status: string }>(
		"SELECT status FROM gitcafe_receipts WHERE id = $1",
		[admitted.receiptId],
	);
	expect(receipt.rows[0]?.status).toBe("pending");
	expect(
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
	).toBe("dispatched");
});

test("historical parked receipts cannot be activated by a protection rollout", async () => {
	const admitted = await admitPullReceipt();
	expect(
		await gitCafeLifecycleServices.processGitCafeReceipt(
			database.db,
			admitted.receiptId,
		),
	).toBe("parked");
	expect(
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		),
	).toBe("parked");
	const rows = await database.pool.query(
		"SELECT id FROM events WHERE delivery_id = $1",
		[JSON.stringify([event.installation.id, admitted.payload.id])],
	);
	expect(rows.rowCount).toBe(0);
});

test("dispatched receipts restore exhausted or missing process jobs once and stop after completion", async () => {
	const admitted = await admitPullReceipt();
	await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
		database.db,
		boss,
		admitted.receiptId,
	);
	const [row] = (
		await database.pool.query<{ id: string }>(
			"SELECT id FROM events WHERE delivery_id=$1",
			[JSON.stringify([event.installation.id, admitted.payload.id])],
		)
	).rows;
	if (!row) throw new Error("Missing event");
	await database.pool.query(
		"UPDATE pgboss.job SET state='failed' WHERE name=$1 AND data->>'eventId'=$2",
		[GITCAFE_PROCESS_EVENT_QUEUE, row.id],
	);
	const counts = await Promise.all(
		Array.from({ length: 6 }, () =>
			gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
		),
	);
	expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
	const live = await database.pool.query(
		"SELECT id FROM pgboss.job WHERE name=$1 AND data->>'eventId'=$2 AND state='created'",
		[GITCAFE_PROCESS_EVENT_QUEUE, row.id],
	);
	expect(live.rowCount).toBe(1);
	await database.pool.query(
		"DELETE FROM pgboss.job WHERE name=$1 AND data->>'eventId'=$2",
		[GITCAFE_PROCESS_EVENT_QUEUE, row.id],
	);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(1);
	await gitCafeLifecycleServices.finishGitCafeEvent(database.db, row.id);
	await database.pool.query(
		"DELETE FROM pgboss.job WHERE name=$1 AND data->>'eventId'=$2",
		[GITCAFE_PROCESS_EVENT_QUEUE, row.id],
	);
	expect(
		await gitCafeLifecycleServices.recoverGitCafeEvents(database.db, boss),
	).toBe(0);
	const receipt = await database.pool.query<{ status: string }>(
		"SELECT status FROM gitcafe_receipts WHERE id=$1",
		[admitted.receiptId],
	);
	expect(receipt.rows[0]?.status).toBe("applied");
});

for (const { verdict, scenario } of [
	{ verdict: "pass", scenario: "healthy" },
	{ verdict: "block", scenario: "healthy" },
	{ verdict: "pass", scenario: "step-outage" },
	{ verdict: "block", scenario: "step-outage" },
	{ verdict: "pass", scenario: "surface-outage" },
	{ verdict: "block", scenario: "surface-outage" },
	{ verdict: "block", scenario: "lost-review" },
	{ verdict: "block", scenario: "review-only" },
	{ verdict: "pass", scenario: "resume-outage" },
	{ verdict: "pass", scenario: "resume-cleanup" },
	{ verdict: "pass", scenario: "cleanup-expired" },
	{ verdict: "pass", scenario: "late-review" },
	{ verdict: "pass", scenario: "resume-race" },
	{ verdict: "pass", scenario: "resume-dispatch-race" },
	{ verdict: "pass", scenario: "resume-restamp-race" },
	{ verdict: "pass", scenario: "closed-phase" },
	{ verdict: "block", scenario: "block-phase-retry" },
	{ verdict: "block", scenario: "refresh-review" },
	{ verdict: "block", scenario: "refresh-closure-race" },
	{ verdict: "pass", scenario: "rerun-outage" },
	{ verdict: "block", scenario: "rerun-outage" },
	{ verdict: "pass", scenario: "native-rerequest" },
	{ verdict: "pass", scenario: "native-rerequest-read-outage" },
	{ verdict: "pass", scenario: "native-rerequest-write-outage" },
	{ verdict: "pass", scenario: "native-rerequest-refresh-outage" },
	{ verdict: "pass", scenario: "native-rerequest-refresh-generation" },
	{ verdict: "pass", scenario: "native-rerequest-refresh-revision" },
	{ verdict: "pass", scenario: "native-rerequest-prepare-binding-revision" },
	{ verdict: "pass", scenario: "native-rerequest-prepare-check-revision" },
	{ verdict: "pass", scenario: "native-rerequest-prepare-pull-revision" },
	{ verdict: "pass", scenario: "native-rerequest-unbound" },
	{ verdict: "pass", scenario: "native-rerequest-generation" },
	{ verdict: "pass", scenario: "native-rerequest-stale-head" },
	{ verdict: "pass", scenario: "native-rerequest-head-change" },
] as const) {
	test(`actual GitCafe runtime persists ${verdict} and owned surfaces across ${scenario}`, async () => {
		const fixture = async (name: string): Promise<unknown> =>
			Bun.file(new URL(`${name}.json`, base)).json();
		const [
			repository,
			token,
			pull,
			changes,
			diff,
			commits,
			profile,
			members,
			collaborators,
			merged,
			comment,
			review,
			createdReview,
			report,
		] = await Promise.all(
			[
				"gitcafe-connection-repository",
				"gitcafe-action-token-current",
				"gitcafe-read-scratch-pull",
				"gitcafe-read-scratch-changes",
				"gitcafe-read-scratch-diff-0",
				"gitcafe-read-scratch-commits",
				"gitcafe-read-profile",
				"gitcafe-connection-members",
				"gitcafe-read-collaborators",
				"gitcafe-read-pulls",
				"gitcafe-action-comment-created",
				"gitcafe-action-review-readback",
				"gitcafe-action-review-created",
				"gitcafe-check-neutral",
			].map(fixture),
		);
		const {
			gitCafeInstallationTokenSchema,
			gitCafeActionCommentSchema,
			gitCafeActionReviewSchema,
			gitCafeActionCreatedReviewSchema,
			gitCafeCheckReportInputSchema,
			gitCafeCheckReportResponseSchema,
			gitCafeActionCommentWriteSchema,
			gitCafeActionReviewCreateSchema,
		} = await import("@tripwire/contracts");
		const tokenData = gitCafeInstallationTokenSchema.parse(token);
		const commentData = gitCafeActionCommentSchema.parse(comment);
		const reviewData = gitCafeActionReviewSchema.parse(review);
		const createdData = gitCafeActionCreatedReviewSchema.parse(createdReview);
		const reportData = gitCafeCheckReportResponseSchema.parse(report);
		const checks: (typeof reportData.checkRun)[] = [];
		const comments: (typeof commentData)[] = [];
		const reviews: (typeof reviewData)[] = [];
		const reviewRequests = new Map<
			string,
			{ input: string; receipt: typeof createdData }
		>();
		let profileReads = 0;
		let rerequestReadStatus = 200;
		let pullReadStatus = 200;
		let changeGenerationOnPull = false;
		let installationRevision = installation.revision;
		let driftInstallation = false;
		let driftLookups = 0;
		let changeRevisionAfterCheck = false;
		let changeHead = false;
		let checkReads = 0;
		let lostReview = false;
		let refuseCleanup = false;
		let reviewBarrier: (() => Promise<void>) | null = null;
		const credentials = {
			appId: installation.appId,
			keyId: "local-runtime-test",
			privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
				.privateKey.export({ format: "pem", type: "pkcs8" })
				.toString(),
		};
		const runtime = buildGitCafeRuntime(
			database.db,
			credentials,
			async (url, init) => {
				const path = new URL(url).pathname;
				if (path.includes("/api/apps/")) {
					if (init.method === "GET" && driftInstallation && ++driftLookups >= 2)
						installationRevision = installation.revision + 1;
					return Response.json(
						init.method === "GET"
							? { ...installation, revision: installationRevision }
							: {
									...tokenData,
									token: "local-runtime-token",
									expiresAt: new Date(Date.now() + 900_000).toISOString(),
								},
					);
				}
				if (path === "/api/repos/boring/scratch")
					return Response.json(repository);
				if (path === "/api/users/grim") {
					profileReads++;
					return Response.json(profile);
				}
				if (path === "/api/orgs/boring/members/") return Response.json(members);
				if (path.endsWith("/collaborators/"))
					return Response.json(collaborators);
				if (path.endsWith("/pulls/")) return Response.json(merged);
				if (path.endsWith("/pulls/1")) {
					if (changeGenerationOnPull) {
						changeGenerationOnPull = false;
						await database.db
							.update(gitCafeInstallationLifecycle)
							.set({ generation: 2 })
							.where(
								eq(
									gitCafeInstallationLifecycle.installationId,
									installation.id,
								),
							);
					}
					return Response.json(
						changeHead
							? {
									...gitCafePullIdentitySchema.parse(pull),
									...gitCafeReadPullSchema.parse(pull),
									headOid: "a".repeat(40),
								}
							: pull,
						{ status: pullReadStatus },
					);
				}
				if (path.endsWith("/pulls/1/changes")) return Response.json(changes);
				if (path.includes("/pulls/1/diff/")) return Response.json(diff);
				if (path.endsWith("/pulls/1/commits")) return Response.json(commits);
				if (
					path.includes("/commits/") &&
					path.endsWith("/check-runs/tripwire")
				) {
					const input = gitCafeCheckReportInputSchema.shape.check.parse(
						JSON.parse(String(init.body)),
					);
					const check = {
						...reportData.checkRun,
						...input,
						key: "tripwire",
						detailsUrl: input.detailsUrl ?? null,
						externalId: input.externalId ?? null,
						conclusion: input.conclusion ?? null,
						output: { ...reportData.checkRun.output, ...input.output },
					};
					checks.push(check);
					return Response.json({ outcome: "updated", checkRun: check });
				}
				if (path.includes("/check-runs/")) {
					if (changeRevisionAfterCheck) {
						changeRevisionAfterCheck = false;
						installationRevision = installation.revision + 1;
					}
					checkReads++;
					return Response.json(checks.at(-1), { status: rerequestReadStatus });
				}
				if (path.endsWith("/comments/")) {
					if (init.method === "GET")
						return Response.json({ items: comments, next: null });
					const body = gitCafeActionCommentWriteSchema.parse(
						JSON.parse(String(init.body)),
					);
					const posted = gitCafeActionCommentSchema.parse({
						...commentData,
						id: `prcomment_${generateId()}`,
						body: body.body,
					});
					comments.push(posted);
					return Response.json(posted);
				}
				if (path.includes("/comments/") && init.method === "PATCH") {
					const index = comments.findIndex((comment) =>
						path.endsWith(comment.id),
					);
					if (index < 0) return new Response(null, { status: 404 });
					const comment = comments[index];
					if (!comment) throw new Error("Missing local comment");
					const input = gitCafeActionCommentWriteSchema.parse(
						JSON.parse(String(init.body)),
					);
					const updated = {
						...comment,
						body: input.body,
						version: comment.version + 1,
					};
					comments[index] = updated;
					return Response.json(updated);
				}
				if (path.endsWith("/reviews")) {
					if (init.method === "GET")
						return Response.json({ items: reviews, next: null });
					const body = gitCafeActionReviewCreateSchema.parse(
						JSON.parse(String(init.body)),
					);
					const previous = reviewRequests.get(body.requestId);
					if (previous)
						return previous.input === JSON.stringify(body)
							? Response.json(previous.receipt)
							: new Response(null, { status: 409 });
					if (scenario === "block-phase-retry" && !lostReview) {
						lostReview = true;
						return new Response(null, { status: 403 });
					}
					await reviewBarrier?.();
					const receipt = { ...createdData, id: `review_${generateId()}` };
					reviewRequests.set(body.requestId, {
						input: JSON.stringify(body),
						receipt,
					});
					reviews.push(
						gitCafeActionReviewSchema.parse({
							...reviewData,
							id: receipt.id,
							body: body.body,
						}),
					);
					if (scenario === "lost-review" && !lostReview) {
						lostReview = true;
						throw new Error("Local lost review response");
					}
					return Response.json(receipt);
				}
				if (path.endsWith("/dismiss") && init.method === "POST") {
					if (refuseCleanup) return new Response(null, { status: 503 });
					const index = reviews.findIndex((review) =>
						path.endsWith(`${review.id}/dismiss`),
					);
					const current = reviews[index];
					if (!current) throw new Error("Missing local review");
					reviews[index] = {
						...current,
						dismissedAt: new Date().toISOString(),
						version: current.version + 1,
					};
					return Response.json(reviews[index]);
				}
				if (path.includes("/reviews/"))
					return Response.json(
						reviews.find((review) => path.endsWith(review.id)),
					);
				return new Response("Unexpected local runtime path", { status: 500 });
			},
		);
		await repoServices.upsertRuleConfig(database.db, repoId, {
			ruleId: verdict === "pass" ? "max-files-changed" : "profile-readme",
			version: 1,
			enabled: true,
			config: verdict === "pass" ? { max: 1 } : { minLength: 100000 },
		});
		if (scenario === "review-only")
			await repoServices.upsertResponseConfig(
				database.db,
				repoId,
				responseConfigSchema.parse({
					onBlock: "silent",
				}),
			);
		const admitted = await admitPullReceipt();
		await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
			database.db,
			boss,
			admitted.receiptId,
		);
		const [row] = (
			await database.pool.query<{ id: string }>(
				"SELECT id FROM events WHERE delivery_id = $1",
				[JSON.stringify([event.installation.id, admitted.payload.id])],
			)
		).rows;
		if (!row) throw new Error("Missing dispatched event");
		const previous = process.env.TRIPWIRE_DISABLE_EXEMPTION;
		process.env.TRIPWIRE_DISABLE_EXEMPTION = "true";
		try {
			const deps = {
				db: database.db,
				pool: database.pool,
				logger: pino({ level: "silent" }),
				resolveForge: (forge: "github" | "opengit" | "gitcafe") =>
					forge === "gitcafe" ? runtime : null,
				makeGenerate: null,
				appUrl: "https://staging.tripwire.sh",
				resumeNormalized: true,
			};
			if (scenario === "step-outage" || scenario === "surface-outage") {
				const table = scenario === "step-outage" ? "run_steps" : "run_actions";
				const condition =
					scenario === "surface-outage"
						? "IF NEW.kind <> 'set-check' THEN RETURN NEW; END IF;"
						: "";
				await database.pool.query(
					`CREATE FUNCTION fail_local_persistence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${condition} RAISE EXCEPTION 'local persistence outage'; END $$`,
				);
				await database.pool.query(
					`CREATE TRIGGER fail_local_persistence BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_local_persistence()`,
				);
				try {
					await expect(
						processEvent(deps, { eventId: row.id }),
					).rejects.toMatchObject({
						cause: { message: "local persistence outage" },
					});
				} finally {
					await database.pool.query(
						`DROP TRIGGER fail_local_persistence ON ${table}`,
					);
					await database.pool.query("DROP FUNCTION fail_local_persistence()");
				}
				if (scenario === "step-outage")
					expect(
						await runServices.getRunForEvent(database.db, row.id),
					).toBeNull();
			}
			const previousReads = profileReads;
			await processEvent(deps, { eventId: row.id });
			const saved = await runServices.getRunForEvent(database.db, row.id);
			if (scenario.startsWith("native-rerequest")) {
				if (!saved) throw new Error("Missing initial run");
				const check = checks.at(-1);
				if (!check?.externalId) throw new Error("Missing owned check");
				const requestedAt = new Date(
					Date.parse(check.reportedAt) + 1,
				).toISOString();
				checks.push({
					...check,
					status: "queued",
					conclusion: null,
					rerequestedAt: requestedAt,
				});
				const source = gitCafeCheckRerequestedEventSchema.parse({
					...gitCafeCheckRerequestedEventSchema.parse(
						await fixture("gitcafe-check-rerequested-webhook"),
					),
					createdAt: requestedAt,
					checkRun: {
						id: check.id,
						key: check.key,
						name: check.name,
						headOid: check.headOid,
						externalId:
							scenario === "native-rerequest-unbound"
								? row.id
								: check.externalId,
						detailsUrl: check.detailsUrl,
					},
				});
				const requested = await admitPullReceipt(source);
				expect(
					await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
						database.db,
						boss,
						requested.receiptId,
					),
				).toBe("dispatched");
				const [requestRow] = (
					await database.pool.query<{ id: string }>(
						"SELECT id FROM events WHERE delivery_id=$1",
						[JSON.stringify([source.installation.id, requested.payload.id])],
					)
				).rows;
				if (!requestRow) throw new Error("Missing re-run event");
				if (scenario.startsWith("native-rerequest-prepare-")) {
					const original = gitCafeActionServices.prepareGitCafeCheckRerun;
					const drift = spyOn(
						gitCafeActionServices,
						"prepareGitCafeCheckRerun",
					).mockImplementation(async (db, input) => {
						const result = await original(db, input);
						if (input.mode === "preview" && result.ok) {
							if (scenario === "native-rerequest-prepare-check-revision")
								installationRevision = installation.revision + 1;
							if (scenario === "native-rerequest-prepare-pull-revision")
								changeRevisionAfterCheck = true;
						}
						return result;
					});
					driftInstallation =
						scenario === "native-rerequest-prepare-binding-revision";
					try {
						expect(await runtime.prepareCheckRerequest(requestRow.id)).toEqual({
							ok: false,
							reason: "inactive",
						});
					} finally {
						drift.mockRestore();
					}
					expect(
						await runServices.getRunById(database.db, requestRow.id),
					).toBeNull();
					expect(
						(await eventServices.getEventById(database.db, requestRow.id))
							?.processedAt,
					).toBeNull();
				}
				if (scenario === "native-rerequest-unbound") {
					expect(await runtime.prepareCheckRerequest(requestRow.id)).toEqual({
						ok: false,
						reason: "identity-mismatch",
					});
					await gitCafeLifecycleServices.finishGitCafeEvent(
						database.db,
						row.id,
					);
					await database.pool.query(
						"DELETE FROM pgboss.job WHERE name=$1 AND data->>'eventId'<>$2",
						[GITCAFE_PROCESS_EVENT_QUEUE, requestRow.id],
					);
					const isolated = await createGitCafeConnectionBoss(
						container.url,
						deps.logger,
					);
					try {
						await registerGitCafeProtectionQueues(
							deps,
							isolated,
							runtime.prepareCheckRerequest,
							runtime,
						);
						const until = Date.now() + 10_000;
						while (
							!(await eventServices.getEventById(database.db, requestRow.id))
								?.processedAt &&
							Date.now() < until
						)
							await Bun.sleep(20);
						expect(
							(await eventServices.getEventById(database.db, requestRow.id))
								?.processedAt,
						).not.toBeNull();
					} finally {
						await isolated.stop();
					}
					expect(
						await runServices.getRunById(database.db, requestRow.id),
					).toBeNull();
					await database.pool.query("DELETE FROM pgboss.job WHERE name=$1", [
						GITCAFE_PROCESS_EVENT_QUEUE,
					]);
					expect(
						await gitCafeLifecycleServices.recoverGitCafeEvents(
							database.db,
							boss,
						),
					).toBe(0);
					return;
				}
				if (scenario === "native-rerequest-read-outage") {
					rerequestReadStatus = 503;
					expect(
						await runtime.prepareCheckRerequest(requestRow.id),
					).toMatchObject({ ok: false, reason: "http", status: 503 });
					expect(
						await runServices.getRunById(database.db, requestRow.id),
					).toBeNull();
					rerequestReadStatus = 200;
				}
				if (scenario === "native-rerequest-write-outage") {
					await database.pool.query(
						"CREATE FUNCTION fail_check_rerun() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='queued' THEN RAISE EXCEPTION 're-run storage outage'; END IF; RETURN NEW; END $$",
					);
					await database.pool.query(
						"CREATE TRIGGER fail_check_rerun BEFORE INSERT ON runs FOR EACH ROW EXECUTE FUNCTION fail_check_rerun()",
					);
					try {
						await expect(
							runtime.prepareCheckRerequest(requestRow.id),
						).rejects.toMatchObject({
							cause: { message: "re-run storage outage" },
						});
					} finally {
						await database.pool.query("DROP TRIGGER fail_check_rerun ON runs");
						await database.pool.query("DROP FUNCTION fail_check_rerun()");
					}
					expect(
						await runServices.getRunById(database.db, requestRow.id),
					).toBeNull();
				}
				if (scenario === "native-rerequest-generation") {
					const original = gitCafeActionServices.prepareGitCafeCheckRerun;
					const drift = spyOn(
						gitCafeActionServices,
						"prepareGitCafeCheckRerun",
					).mockImplementation(async (db, input) => {
						if (input.mode === "create")
							await database.db
								.update(gitCafeInstallationLifecycle)
								.set({ generation: 2 })
								.where(
									eq(
										gitCafeInstallationLifecycle.installationId,
										installation.id,
									),
								);
						return original(db, input);
					});
					try {
						expect(await runtime.prepareCheckRerequest(requestRow.id)).toEqual({
							ok: false,
							reason: "inactive",
						});
					} finally {
						drift.mockRestore();
					}
					expect(
						await runServices.getRunById(database.db, requestRow.id),
					).toBeNull();
				}
				if (scenario === "native-rerequest-stale-head") {
					changeHead = true;
					expect(await runtime.prepareCheckRerequest(requestRow.id)).toEqual({
						ok: false,
						reason: "stale",
					});
					expect(
						await runServices.getRunById(database.db, requestRow.id),
					).toBeNull();
					return;
				}
				const preparations = await Promise.all(
					Array.from({ length: 5 }, () =>
						runtime.prepareCheckRerequest(requestRow.id),
					),
				);
				const prepared = preparations[0];
				if (!prepared?.ok)
					throw new Error(
						`Missing prepared re-run: ${JSON.stringify(prepared)}`,
					);
				expect(preparations).toEqual(Array(5).fill(prepared));
				expect(prepared.value.runId).toBe(requestRow.id);
				expect(
					(
						await database.pool.query("SELECT id FROM runs WHERE id=$1", [
							requestRow.id,
						])
					).rowCount,
				).toBe(1);
				if (
					scenario === "native-rerequest-refresh-generation" ||
					scenario === "native-rerequest-refresh-revision"
				) {
					changeGenerationOnPull =
						scenario === "native-rerequest-refresh-generation";
					driftInstallation = scenario === "native-rerequest-refresh-revision";
					await expect(
						rerunChangeRequest(deps, prepared.value),
					).rejects.toThrow("GitCafe re-run evidence temporarily unavailable");
					expect(
						(await runServices.getRunById(database.db, requestRow.id))?.status,
					).toBe("queued");
					expect(
						(await eventServices.getEventById(database.db, requestRow.id))
							?.processedAt,
					).toBeNull();
					expect(await runtime.prepareCheckRerequest(requestRow.id)).toEqual(
						prepared,
					);
					if (scenario === "native-rerequest-refresh-revision")
						expect(driftLookups).toBeGreaterThanOrEqual(2);
				}
				if (scenario === "native-rerequest-refresh-outage") {
					const ordinaryQueued = await runServices.createRun(database.db, {
						eventId: row.id,
						repoFullName: saved.repoFullName,
						subjectNumber: saved.subjectNumber,
						headSha: saved.headSha,
						snapshot: workflowDefinitionSchema
							.array()
							.parse(saved.workflowSnapshot),
						status: "queued",
						verdict: null,
					});
					pullReadStatus = 503;
					await expect(
						rerunChangeRequest(deps, prepared.value),
					).rejects.toThrow("GitCafe re-run evidence temporarily unavailable");
					expect(
						(await runServices.getRunById(database.db, requestRow.id))?.status,
					).toBe("queued");
					await database.pool.query(
						"UPDATE runs SET created_at=now()-interval '4 minutes' WHERE id=ANY($1::text[])",
						[[requestRow.id, ordinaryQueued]],
					);
					await sweepActions(
						{ ...deps, adapterFor: async () => runtime.adapter },
						{ forge: "gitcafe" },
					);
					expect(
						(await runServices.getRunById(database.db, requestRow.id))?.status,
					).toBe("queued");
					expect(
						(await runServices.getRunById(database.db, ordinaryQueued))?.status,
					).toBe("failed");
					pullReadStatus = 200;
				}
				if (scenario === "native-rerequest-head-change") {
					changeHead = true;
					const previousReads = profileReads;
					const previousChecks = checks.length;
					await rerunChangeRequest(deps, prepared.value);
					expect(
						(await runServices.getRunById(database.db, requestRow.id))?.status,
					).toBe("failed");
					expect(profileReads).toBe(previousReads);
					expect(checks).toHaveLength(previousChecks);
					return;
				}
				await rerunChangeRequest(deps, prepared.value);
				expect(
					(await runServices.getRunById(database.db, requestRow.id))?.status,
				).toBe("completed");
				expect(checks.at(-1)?.conclusion).toBe("success");
				const beforeReads = profileReads;
				const beforeChecks = checkReads;
				const replay = await runtime.prepareCheckRerequest(requestRow.id);
				expect(replay).toEqual(prepared);
				expect(checkReads).toBe(beforeChecks);
				if (!replay.ok) throw new Error("Missing retry");
				await rerunChangeRequest(deps, replay.value);
				expect(profileReads).toBe(beforeReads);
				return;
			}
			if (!saved) throw new Error("Missing evaluated run");
			const surfaceDeps = {
				db: database.db,
				adapter: runtime.adapter,
				logger: deps.logger,
				appUrl: deps.appUrl,
			};
			if (scenario === "refresh-review") {
				await repoServices.upsertResponseConfig(
					database.db,
					repoId,
					responseConfigSchema.parse({
						onBlock: "silent",
						blocks: {
							block: [
								{
									id: "updated",
									type: "text",
									parts: [
										{ kind: "text", text: "Updated staging review content." },
									],
								},
							],
						},
					}),
				);
				const jobId = generateId();
				await refreshRepoSurfaces(deps, { repoId }, jobId);
				expect(reviews).toHaveLength(2);
				expect(reviews[0]?.dismissedAt).not.toBeNull();
				expect(reviews[1]?.dismissedAt).toBeNull();
				expect(reviews[1]?.body).toContain("Updated staging review content.");
				await refreshRepoSurfaces(deps, { repoId }, jobId);
				expect(reviews).toHaveLength(2);
				expect(checks.at(-1)?.conclusion).toBe("failure");
				return;
			}
			if (scenario === "refresh-closure-race") {
				await database.pool.query(
					"UPDATE runs SET status='paused' WHERE id=$1",
					[saved.id],
				);
				await moderationServices.createModerationItem(database.db, {
					runId: saved.id,
					nodeId: "run:degraded",
				});
				let arrived: (() => void) | undefined;
				let release: (() => void) | undefined;
				const paused = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const barrier = new Promise<void>((resolve) => {
					release = resolve;
				});
				const original = runServices.recordGitCafeSurfaceActions;
				let intercepted = false;
				const spy = spyOn(
					runServices,
					"recordGitCafeSurfaceActions",
				).mockImplementation(
					async (db, id, phase, actions, pendingIds, bodies) => {
						if (!intercepted && id === saved.id) {
							intercepted = true;
							arrived?.();
							await barrier;
						}
						return original(db, id, phase, actions, pendingIds, bodies);
					},
				);
				const refresh = refreshRepoSurfaces(deps, { repoId }, generateId());
				try {
					await paused;
					const closed = await moderationServices.closeReviewsForChangeRequest(
						database.db,
						deps.appUrl,
						{ forge: "gitcafe", fullName: saved.repoFullName },
						1,
					);
					await emitClosedReviewSurfaces(
						{ ...surfaceDeps, adapterFor: async () => runtime.adapter },
						closed,
					);
					expect(checks.at(-1)?.conclusion).toBe("neutral");
				} finally {
					release?.();
					await refresh;
					spy.mockRestore();
				}
				expect(
					(await runServices.getRunById(database.db, saved.id))?.status,
				).toBe("closed");
				expect(checks.at(-1)?.conclusion).toBe("neutral");
				expect(reviews).toHaveLength(1);
				return;
			}
			if (scenario === "closed-phase") {
				const runId = await runServices.createRun(database.db, {
					eventId: saved.eventId,
					repoFullName: saved.repoFullName,
					subjectNumber: 1,
					headSha: saved.headSha,
					snapshot: [deriveDefaultWorkflow([])],
					status: "paused",
					verdict: "needs_review",
				});
				const itemId = await moderationServices.createModerationItem(
					database.db,
					{ runId, nodeId: "run:degraded" },
				);
				const normalized = normalizedEventSchema.parse(
					(await eventServices.getEventById(database.db, saved.eventId))
						?.normalized,
				);
				await emitPrSurface(surfaceDeps, {
					runId,
					event: normalized,
					verdict: "needs_review",
					reasons: [],
					pendingActionRows: [],
					pendingCheckPosted: true,
				});
				expect(checks.at(-1)?.conclusion).toBe("action_required");
				await database.pool.query(
					"CREATE FUNCTION fail_closed_surface() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='set-check' AND NEW.payload->>'conclusion'='neutral' THEN RAISE EXCEPTION 'closed surface outage'; END IF; RETURN NEW; END $$",
				);
				await database.pool.query(
					"CREATE TRIGGER fail_closed_surface BEFORE INSERT ON run_actions FOR EACH ROW EXECUTE FUNCTION fail_closed_surface()",
				);
				try {
					await expect(
						moderationServices.closeReviewsForChangeRequest(
							database.db,
							deps.appUrl,
							{ forge: "gitcafe", fullName: saved.repoFullName },
							1,
						),
					).rejects.toMatchObject({
						cause: { message: "closed surface outage" },
					});
				} finally {
					await database.pool.query(
						"DROP TRIGGER fail_closed_surface ON run_actions",
					);
					await database.pool.query("DROP FUNCTION fail_closed_surface()");
				}
				expect((await runServices.getRunById(database.db, runId))?.status).toBe(
					"paused",
				);
				expect(
					(await moderationServices.getModerationItem(database.db, itemId))
						?.status,
				).toBe("pending");
				const closed = await moderationServices.closeReviewsForChangeRequest(
					database.db,
					deps.appUrl,
					{ forge: "gitcafe", fullName: saved.repoFullName },
					1,
				);
				expect(closed).toHaveLength(1);
				await emitClosedReviewSurfaces(
					{ ...surfaceDeps, adapterFor: async () => runtime.adapter },
					closed,
				);
				expect(checks.at(-1)?.conclusion).toBe("neutral");
				expect((await runServices.getRunById(database.db, runId))?.status).toBe(
					"closed",
				);
				const audit = await runServices.getRunWithSteps(database.db, runId);
				expect(
					audit?.actions.filter((action) =>
						action.idempotencyKey.endsWith(":closed"),
					),
				).toHaveLength(2);
				expect(
					audit?.actions
						.filter((action) => action.idempotencyKey.endsWith(":closed"))
						.every((action) => action.status === "executed"),
				).toBe(true);
				expect(
					await recoverGitCafeRunSurface(surfaceDeps, runId, normalized),
				).toBe(true);
				return;
			}
			if (scenario === "block-phase-retry") {
				expect(reviews).toHaveLength(0);
				await runServices.pauseRun(database.db, saved.id);
				const itemId = await moderationServices.createModerationItem(
					database.db,
					{ runId: saved.id, nodeId: "run:degraded" },
				);
				await database.pool.query(
					"UPDATE moderation_items SET status='approved' WHERE id=$1",
					[itemId],
				);
				await resumeRun(deps, { itemId, decision: "approve" });
				expect(
					(await runServices.getRunById(database.db, saved.id))?.verdict,
				).toBe("block");
				expect(reviews).toHaveLength(1);
				expect(reviews[0]?.dismissedAt).toBeNull();
				expect(checks.at(-1)?.conclusion).toBe("failure");
				const audit = await runServices.getRunWithSteps(database.db, saved.id);
				expect(
					audit?.actions
						.filter((action) => action.kind === "block")
						.map((action) => action.status)
						.sort(),
				).toEqual(["executed", "superseded"]);
				return;
			}
			if (
				scenario === "resume-race" ||
				scenario === "resume-dispatch-race" ||
				scenario === "resume-restamp-race"
			) {
				const definition = workflowDefinitionSchema.parse({
					id: "race@1",
					name: "Two moderation branches",
					version: 1,
					nodes: [
						{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
						{ id: "a", type: "action", action: "send-to-moderation" },
						{ id: "b", type: "action", action: "send-to-moderation" },
						{ id: "block", type: "action", action: "block" },
					],
					edges: [
						{ id: "ta", from: "t", to: "a" },
						{ id: "tb", from: "t", to: "b" },
						{ id: "bb", from: "b", to: "block", when: "deny" },
					],
				});
				const runId = await runServices.createRun(database.db, {
					eventId: saved.eventId,
					repoFullName: saved.repoFullName,
					subjectNumber: 1,
					headSha: saved.headSha,
					snapshot: [definition],
					status: "paused",
					verdict: "needs_review",
				});
				const now = new Date().toISOString();
				await runServices.recordSteps(
					database.db,
					runId,
					["t", "a", "b"].map((node) => ({
						nodeId: `race@1:${node}`,
						nodeKind: node === "t" ? "trigger" : "action",
						status: node === "t" ? "pass" : "paused",
						input: null,
						output: null,
						startedAt: now,
						finishedAt: now,
						durationMs: 0,
					})),
				);
				const a = await moderationServices.createModerationItem(database.db, {
					runId,
					nodeId: "race@1:a",
				});
				const b = await moderationServices.createModerationItem(database.db, {
					runId,
					nodeId: "race@1:b",
				});
				await database.pool.query(
					"UPDATE moderation_items SET status='approved' WHERE id=$1",
					[a],
				);
				await database.pool.query(
					"UPDATE moderation_items SET status='denied' WHERE id=$1",
					[b],
				);
				let arrived: (() => void) | undefined;
				let release: (() => void) | undefined;
				const paused = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const barrier = new Promise<void>((resolve) => {
					release = resolve;
				});
				const original = runServices.recordGitCafeSurfaceActions;
				let intercepted = false;
				if (!runtime.adapter) throw new Error("Missing runtime adapter");
				const originalExecute = runtime.adapter.execute.bind(runtime.adapter);
				const spy =
					scenario === "resume-race"
						? spyOn(
								runServices,
								"recordGitCafeSurfaceActions",
							).mockImplementation(
								async (db, id, phase, actions, pendingIds, bodies) => {
									if (
										!intercepted &&
										id === runId &&
										phase.verdict === "needs_review"
									) {
										intercepted = true;
										arrived?.();
										await barrier;
									}
									return original(db, id, phase, actions, pendingIds, bodies);
								},
							)
						: spyOn(runtime.adapter, "execute").mockImplementation(
								async (action, context) => {
									if (!intercepted && action.kind === "dismiss-review") {
										intercepted = true;
										arrived?.();
										await barrier;
									}
									return originalExecute(action, context);
								},
							);
				let older: Promise<void>;
				const restampSpy =
					scenario === "resume-restamp-race"
						? spyOn(
								runServices,
								"recordGitCafeSurfaceActions",
							).mockImplementation(
								async (db, id, phase, actions, pendingIds, bodies) => {
									const result = await original(
										db,
										id,
										phase,
										actions,
										pendingIds,
										bodies,
									);
									if (id === runId && phase.verdict === "block") {
										const audit = await runServices.getRunWithSteps(
											database.db,
											runId,
										);
										const block = audit?.actions.find(
											(row) =>
												row.kind === "block" && row.status === "recorded",
										);
										if (!block) throw new Error("Missing denial block intent");
										const payload = gitCafeActionPayloadSchema.parse(
											block.payload,
										);
										const sent = await originalExecute(
											toForgeAction(
												{ ...block, payload },
												saved.repoFullName,
												1,
												payload.reason ?? "Blocked.",
												null,
											),
											{ actionId: block.id },
										);
										expect("refused" in sent).toBe(false);
										if (!("refused" in sent))
											await runServices.markActionExecuted(
												database.db,
												block.id,
												sent.externalId,
											);
										release?.();
										await older;
									}
									return result;
								},
							)
						: undefined;
				older = resumeRun(deps, { itemId: a, decision: "approve" });
				try {
					await paused;
					await resumeRun(deps, { itemId: b, decision: "deny" });
					expect(reviews[0]?.dismissedAt).toBeNull();
					expect(checks.at(-1)?.conclusion).toBe("failure");
				} finally {
					release?.();
					await older;
					spy.mockRestore();
					restampSpy?.mockRestore();
				}
				if (scenario === "resume-restamp-race")
					await resumeRun(deps, { itemId: b, decision: "deny" });
				expect(
					(await runServices.getRunById(database.db, runId))?.verdict,
				).toBe("block");
				expect(reviews).toHaveLength(1);
				expect(reviews[0]?.dismissedAt).toBeNull();
				expect(checks.at(-1)?.conclusion).toBe("failure");
				return;
			}
			if (scenario === "rerun-outage") {
				if (verdict === "block")
					await repoServices.upsertRuleConfig(database.db, repoId, {
						ruleId: "profile-readme",
						version: 1,
						enabled: true,
						config: { minLength: 1 },
					});
				const queuedId = await runServices.createRun(database.db, {
					eventId: saved.eventId,
					repoFullName: saved.repoFullName,
					subjectNumber: 1,
					headSha: saved.headSha,
					snapshot: [deriveDefaultWorkflow([])],
					status: "queued",
					verdict: null,
					triggeredBy: "local-reviewer",
				});
				const job = {
					forge: "gitcafe" as const,
					repoFullName: saved.repoFullName,
					number: 1,
					requestedBy: "local-reviewer",
					runId: queuedId,
				};
				await database.pool.query(
					"CREATE FUNCTION fail_rerun_surface() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='set-check' THEN RAISE EXCEPTION 'rerun surface outage'; END IF; RETURN NEW; END $$",
				);
				await database.pool.query(
					"CREATE TRIGGER fail_rerun_surface BEFORE INSERT ON run_actions FOR EACH ROW EXECUTE FUNCTION fail_rerun_surface()",
				);
				try {
					await expect(rerunChangeRequest(deps, job)).rejects.toMatchObject({
						cause: { message: "rerun surface outage" },
					});
				} finally {
					await database.pool.query(
						"DROP TRIGGER fail_rerun_surface ON run_actions",
					);
					await database.pool.query("DROP FUNCTION fail_rerun_surface()");
				}
				expect(
					(await runServices.getRunById(database.db, queuedId))?.verdict,
				).toBe("pass");
				const previousReads = profileReads;
				await rerunChangeRequest(deps, job);
				expect(profileReads).toBe(previousReads);
				expect(checks.at(-1)?.conclusion).toBe("success");
				if (verdict === "block") expect(reviews[0]?.dismissedAt).not.toBeNull();
				const actions = await runServices.getRunWithSteps(
					database.db,
					queuedId,
				);
				expect(
					actions?.actions.filter((action) => action.kind === "dismiss-review"),
				).toHaveLength(1);
				await rerunChangeRequest(deps, job);
				expect(
					(await runServices.getRunWithSteps(database.db, queuedId))?.actions,
				).toEqual(actions?.actions);
				return;
			}
			if (scenario === "resume-outage" || scenario === "resume-cleanup") {
				reviews.push(reviewData);
				refuseCleanup = scenario === "resume-cleanup";
				await runServices.pauseRun(database.db, saved.id);
				await emitPrSurface(surfaceDeps, {
					runId: saved.id,
					event: normalizedEventSchema.parse(
						(await eventServices.getEventById(database.db, row.id))?.normalized,
					),
					verdict: "needs_review",
					reasons: [],
					pendingActionRows: [],
					pendingCheckPosted: true,
				});
				const itemId = await moderationServices.createModerationItem(
					database.db,
					{ runId: saved.id, nodeId: "run:degraded" },
				);
				await database.pool.query(
					"UPDATE moderation_items SET status='approved' WHERE id=$1",
					[itemId],
				);
				if (scenario === "resume-outage") {
					await database.pool.query(
						"CREATE FUNCTION fail_resume_surface() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'set-check' THEN RAISE EXCEPTION 'resume surface outage'; END IF; RETURN NEW; END $$",
					);
					await database.pool.query(
						"CREATE TRIGGER fail_resume_surface BEFORE INSERT ON run_actions FOR EACH ROW EXECUTE FUNCTION fail_resume_surface()",
					);
					try {
						await expect(
							resumeRun(deps, { itemId, decision: "approve" }),
						).rejects.toMatchObject({
							cause: { message: "resume surface outage" },
						});
					} finally {
						await database.pool.query(
							"DROP TRIGGER fail_resume_surface ON run_actions",
						);
						await database.pool.query("DROP FUNCTION fail_resume_surface()");
					}
					expect(
						(await runServices.getRunById(database.db, saved.id))?.status,
					).toBe("completed");
				}
				await resumeRun(deps, { itemId, decision: "approve" });
				if (scenario === "resume-cleanup") {
					expect(reviews[0]?.dismissedAt).toBeNull();
					expect(checks.at(-1)?.conclusion).not.toBe("success");
					refuseCleanup = false;
					await resumeRun(deps, { itemId, decision: "approve" });
				}
				expect(reviews[0]?.dismissedAt).not.toBeNull();
				expect(checks.at(-1)?.conclusion).toBe("success");
				const beforeReplay = await runServices.listRunActions(
					database.db,
					saved.id,
				);
				const commentCount = comments.length;
				await resumeRun(deps, { itemId, decision: "approve" });
				expect(await runServices.listRunActions(database.db, saved.id)).toEqual(
					beforeReplay,
				);
				expect(comments).toHaveLength(commentCount);
				return;
			}
			if (scenario === "cleanup-expired") {
				reviews.push(reviewData);
				refuseCleanup = true;
				const [cleanup] = await runServices.recordActions(
					database.db,
					saved.id,
					[
						{
							kind: "dismiss-review",
							payload: { number: 1, reviewId: null, verdict: "pass" },
							idempotencyKey: "retry-cleanup",
						},
						{
							kind: "set-check",
							payload: {
								sha: saved.headSha,
								conclusion: "success",
								summary: "passed",
								detailsUrl: deps.appUrl,
							},
							idempotencyKey: "retry-green",
						},
					],
				);
				if (!cleanup) throw new Error("Missing cleanup");
				await database.pool.query(
					"UPDATE run_actions SET recorded_at=now()-interval '61 minutes' WHERE run_id=$1",
					[saved.id],
				);
				const priorChecks = checks.length;
				for (let attempt = 0; attempt < 2; attempt++)
					await sweepActions(
						{ ...surfaceDeps, adapterFor: async () => runtime.adapter },
						{ forge: "gitcafe", recordedBefore: new Date(Date.now() + 1000) },
					);
				expect(checks).toHaveLength(priorChecks);
				expect(reviews[0]?.dismissedAt).toBeNull();
				expect(
					(
						await runServices.getRunWithSteps(database.db, saved.id)
					)?.actions.find((action) => action.id === cleanup.id)?.status,
				).toBe("recorded");
				return;
			}
			if (scenario === "late-review") {
				const [block] = await runServices.recordActions(database.db, saved.id, [
					{
						kind: "block",
						payload: { reason: "old block" },
						idempotencyKey: "late-block",
					},
				]);
				if (!block || !runtime.adapter)
					throw new Error("Missing block adapter");
				let arrived: (() => void) | undefined;
				let release: (() => void) | undefined;
				const atPost = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const barrier = new Promise<void>((resolve) => {
					release = resolve;
				});
				reviewBarrier = async () => {
					arrived?.();
					await barrier;
				};
				const older = runtime.adapter.execute(
					{
						kind: "block",
						repoFullName: "boring/scratch",
						number: 1,
						reason: "old block",
					},
					{ actionId: block.id },
				);
				await atPost;
				const nextRun = await runServices.createRun(database.db, {
					eventId: saved.eventId,
					repoFullName: saved.repoFullName,
					subjectNumber: 1,
					headSha: saved.headSha,
					snapshot: [deriveDefaultWorkflow([])],
					status: "completed",
					verdict: "pass",
				});
				const before = checks.length;
				const clearing = emitPrSurface(surfaceDeps, {
					runId: nextRun,
					event: normalizedEventSchema.parse(
						(await eventServices.getEventById(database.db, row.id))?.normalized,
					),
					verdict: "pass",
					reasons: [],
					pendingActionRows: [],
					pendingCheckPosted: true,
				});
				await new Promise<void>((resolve) => setTimeout(resolve, 50));
				expect(checks).toHaveLength(before);
				release?.();
				await older;
				await clearing;
				expect(reviews).toHaveLength(1);
				expect(reviews[0]?.dismissedAt).not.toBeNull();
				expect(checks.at(-1)?.conclusion).toBe("success");
				return;
			}
			if (scenario === "surface-outage")
				expect(profileReads).toBe(previousReads);
			if (scenario === "lost-review") {
				const initial = await runServices.getRunForEvent(database.db, row.id);
				expect(initial?.verdict).toBe("block");
				expect(reviews[0]?.dismissedAt).toBeNull();
				await repoServices.upsertRuleConfig(database.db, repoId, {
					ruleId: "profile-readme",
					version: 1,
					enabled: true,
					config: { minLength: 1 },
				});
				const next = await admitPullReceipt();
				await gitCafeLifecycleServices.dispatchGitCafeRepositoryReceipt(
					database.db,
					boss,
					next.receiptId,
				);
				const [current] = (
					await database.pool.query<{ id: string }>(
						"SELECT id FROM events WHERE delivery_id=$1",
						[JSON.stringify([event.installation.id, next.payload.id])],
					)
				).rows;
				if (!current) throw new Error("Missing next event");
				await processEvent(deps, { eventId: current.id });
				expect(
					(await runServices.getRunForEvent(database.db, current.id))?.verdict,
				).toBe("pass");
				expect(reviews[0]?.dismissedAt).not.toBeNull();
				expect(checks.at(-1)?.conclusion).toBe("success");
			}
		} finally {
			if (previous === undefined) delete process.env.TRIPWIRE_DISABLE_EXEMPTION;
			else process.env.TRIPWIRE_DISABLE_EXEMPTION = previous;
		}
		const run = await runServices.getRunForEvent(database.db, row.id);
		expect(run?.verdict).toBe(verdict);
		expect(run?.status).toBe("completed");
		if (scenario !== "lost-review")
			expect(checks.at(-1)?.conclusion).toBe(
				verdict === "pass" ? "success" : "failure",
			);
		if (scenario !== "lost-review")
			expect(comments).toHaveLength(
				verdict === "block" && scenario !== "review-only" ? 1 : 0,
			);
		if (scenario === "review-only") {
			expect(reviews[0]?.body).toContain("https://staging.tripwire.sh/runs/");
			expect(reviews[0]?.body).not.toBe(
				"Blocked. See the Tripwire comment for details.",
			);
		}
		if (verdict === "block") expect(reviews).toHaveLength(1);
		const actions = await database.pool.query<{ kind: string; status: string }>(
			"SELECT kind,status FROM run_actions WHERE run_id = $1",
			[run?.id],
		);
		expect(actions.rows.length).toBeGreaterThan(0);
		if (scenario !== "lost-review")
			expect(actions.rows.every((action) => action.status === "executed")).toBe(
				true,
			);
	}, 20_000);
}
