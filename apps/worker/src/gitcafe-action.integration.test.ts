import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_RECEIPT_APP_ID,
	type GitCafeActionOperation,
	gitCafeActionOperationSchema,
	gitCafeInstallationSchema,
	gitCafePullEventSchema,
	gitCafeReceiptSchema,
} from "@tripwire/contracts";
import { deriveDefaultWorkflow } from "@tripwire/core";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	eventServices,
	gitCafeActionServices,
	gitCafeInstallationLifecycle,
	gitCafeLifecycleServices,
	organization,
	organizationInstallations,
	repoServices,
	repos,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import { normalizeGitCafePullEvent } from "@tripwire/forge-gitcafe";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { buildGitCafeRuntime } from "./gitcafe-runtime.ts";
import { processEvent } from "./jobs/process-event.ts";

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

async function admitPullReceipt() {
	const payload = { ...event, id: `evt_${generateId()}` };
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
		let profileReads = 0;
		let lostReview = false;
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
				if (path.includes("/api/apps/"))
					return Response.json(
						init.method === "GET"
							? installation
							: {
									...tokenData,
									token: "local-runtime-token",
									expiresAt: new Date(Date.now() + 900_000).toISOString(),
								},
					);
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
				if (path.endsWith("/pulls/1")) return Response.json(pull);
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
				if (path.includes("/check-runs/")) return Response.json(checks.at(-1));
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
					reviews.push(
						gitCafeActionReviewSchema.parse({ ...reviewData, body: body.body }),
					);
					if (scenario === "lost-review" && !lostReview) {
						lostReview = true;
						throw new Error("Local lost review response");
					}
					return Response.json({ ...createdData, body: body.body });
				}
				if (path.endsWith("/dismiss") && init.method === "POST") {
					const current = reviews[0];
					if (!current) throw new Error("Missing local review");
					reviews[0] = {
						...current,
						dismissedAt: new Date().toISOString(),
						version: current.version + 1,
					};
					return Response.json(reviews[0]);
				}
				if (path.includes("/reviews/")) return Response.json(reviews.at(-1));
				return new Response("Unexpected local runtime path", { status: 500 });
			},
		);
		await repoServices.upsertRuleConfig(database.db, repoId, {
			ruleId: verdict === "pass" ? "max-files-changed" : "profile-readme",
			version: 1,
			enabled: true,
			config: verdict === "pass" ? { max: 1 } : { minLength: 100000 },
		});
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
			expect(comments).toHaveLength(verdict === "block" ? 1 : 0);
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
	});
}
