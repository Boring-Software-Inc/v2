import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { deriveDefaultWorkflow } from "@tripwire/core";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { emitPrSurface } from "./jobs/pr-surface.ts";
import { sweepActions } from "./jobs/sweep-actions.ts";

/**
 * §5.12 surface sweeper (live-test surprise #3) + comment ownership (§6 live
 * finding): stuck `recorded` actions recover after an outage, but never
 * regress the PR surface — an older run's comment is superseded, its per-SHA
 * check still posts.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });

const SNAPSHOT = [deriveDefaultWorkflow([])];
const FUTURE = () => new Date(Date.now() + 60_000);
const PAST = () => new Date(Date.now() - 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeAdapter() {
	const executed: { kind: string; detail: string }[] = [];
	return {
		executed,
		adapter: {
			forge: "github" as const,
			verifyWebhook: () => true,
			normalizeWebhook: () => null,
			getDiff: () => Promise.resolve([]),
			getCommits: () => Promise.resolve([]),
			readFile: () => Promise.resolve(null),
			getContributorProfile: () => Promise.reject(new Error("unused")),
			execute: (action: {
				kind: string;
				check?: { sha: string; conclusion: string };
				body?: string;
			}) => {
				executed.push({
					kind: action.kind,
					detail:
						action.kind === "set-check"
							? `${action.check?.conclusion}:${action.check?.sha.slice(0, 7)}`
							: (action.body?.split("\n")[0] ?? ""),
				});
				return Promise.resolve({ externalId: `ext-${executed.length}` });
			},
		},
	};
}

async function insertEvent(
	deliveryId: string,
	kind = "change-request.opened",
): Promise<string> {
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind: "pull_request",
		raw: { action: "opened" },
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
	await pool.query("UPDATE events SET kind = $1 WHERE id = $2", [
		kind,
		eventId,
	]);
	return eventId;
}

async function actionStatuses(runId: string): Promise<Record<string, string>> {
	const rows = await pool.query(
		"SELECT idempotency_key, status FROM run_actions WHERE run_id = $1",
		[runId],
	);
	return Object.fromEntries(
		rows.rows.map((r) => [r.idempotency_key, r.status]),
	);
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("sweepActions", () => {
	for (const kind of ["block", "dismiss-review", "request-review"] as const) {
		test(`failed ${kind} remains recorded until delivery recovers`, async () => {
			const base = normalizedEventSchema.parse(
				await Bun.file(
					new URL(
						"../../../packages/core/fixtures/change-request.opened.event.json",
						import.meta.url,
					),
				).json(),
			);
			if (!("changeRequest" in base)) throw new Error("expected PR fixture");
			const repoFullName = `acme/recover-${kind}`;
			const event = normalizedEventSchema.parse({
				...base,
				repo: { ...base.repo, fullName: repoFullName },
			});
			const runId = await runServices.createRun(db, {
				eventId: await insertEvent(`surface-recover-${kind}`),
				repoFullName,
				subjectNumber: base.changeRequest.number,
				headSha: base.changeRequest.headSha,
				snapshot: SNAPSHOT,
				status: "completed",
				verdict: "block",
			});
			const rows = await runServices.recordActions(db, runId, [
				{
					kind,
					payload: {
						number: base.changeRequest.number,
						reviewId: "review-to-dismiss",
						reviewers: ["maintainer"],
					},
					idempotencyKey: `recover:${kind}`,
				},
			]);
			const fake = fakeAdapter();
			let available = false;
			let attempts = 0;
			const adapter: ForgeAdapter = {
				...fake.adapter,
				execute: async (action) => {
					if (action.kind === kind) {
						attempts++;
						if (!available) throw new Error("synthetic forge outage");
					}
					return fake.adapter.execute(action);
				},
			};
			await emitPrSurface(
				{ db, adapter, logger, appUrl: "https://tripwire.sh" },
				{
					runId,
					verdict: "block",
					event,
					reasons: [],
					pendingActionRows: rows,
				},
			);
			expect(attempts).toBe(1);
			expect((await actionStatuses(runId))[`recover:${kind}`]).toBe("recorded");
			const sweep = () =>
				sweepActions(
					{
						db,
						adapterFor: async () => adapter,
						logger,
						appUrl: "https://tripwire.sh",
					},
					{ recordedBefore: FUTURE(), giveUpBefore: PAST() },
				);
			await sweep();
			expect(attempts).toBe(2);
			expect((await actionStatuses(runId))[`recover:${kind}`]).toBe("recorded");
			available = true;
			await sweep();
			expect(attempts).toBe(3);
			expect((await actionStatuses(runId))[`recover:${kind}`]).toBe("executed");
			expect(
				fake.executed.filter((action) => action.kind === kind),
			).toHaveLength(1);
			await sweep();
			expect(attempts).toBe(3);
		});
	}

	test("recorded under a failing adapter ⇒ recovers ⇒ executed", async () => {
		const eventId = await insertEvent("sweep-recover");
		const sha = "a".repeat(40);
		const runId = await runServices.createRun(db, {
			eventId,
			repoFullName: "acme/recover",
			subjectNumber: 1,
			headSha: sha,
			snapshot: SNAPSHOT,
			status: "completed",
			verdict: "block",
		});
		await runServices.recordActions(db, runId, [
			{
				kind: "comment",
				payload: { number: 1, body: "**tripwire: blocked**" },
				idempotencyKey: "comment:1:block",
			},
			{
				kind: "set-check",
				payload: {
					sha,
					conclusion: "failure",
					summary: "blocked",
					detailsUrl: "u",
				},
				idempotencyKey: `check:${sha}:block`,
			},
		]);

		const fake = fakeAdapter();
		const result = await sweepActions(
			{
				db,
				adapterFor: () => Promise.resolve(fake.adapter as never),
				logger,
				appUrl: "http://localhost:3000",
			},
			{ recordedBefore: FUTURE(), giveUpBefore: PAST() },
		);
		expect(result.executed).toBe(2);
		const statuses = await actionStatuses(runId);
		expect(statuses["comment:1:block"]).toBe("executed");
		expect(statuses[`check:${sha}:block`]).toBe("executed");
	});

	test("verdict moved on ⇒ stale needs_review actions superseded, block surface intact", async () => {
		const eventId = await insertEvent("sweep-stale");
		const sha = "b".repeat(40);
		const runId = await runServices.createRun(db, {
			eventId,
			repoFullName: "acme/stale",
			subjectNumber: 2,
			headSha: sha,
			snapshot: SNAPSHOT,
			status: "completed",
			verdict: "block",
		});
		// degraded emit while creds were down — recorded, never executed.
		await runServices.recordActions(db, runId, [
			{
				kind: "comment",
				payload: { number: 2, body: "sent to review" },
				idempotencyKey: "comment:2:needs_review",
			},
			{
				kind: "set-check",
				payload: {
					sha,
					conclusion: "neutral",
					summary: "review",
					detailsUrl: "u",
				},
				idempotencyKey: `check:${sha}:needs_review`,
			},
		]);
		await sleep(15);
		// deny resumed the run to block — these executed.
		const blockRows = await runServices.recordActions(db, runId, [
			{
				kind: "comment",
				payload: { number: 2, body: "**tripwire: blocked**" },
				idempotencyKey: "comment:2:block",
			},
			{
				kind: "set-check",
				payload: {
					sha,
					conclusion: "failure",
					summary: "blocked",
					detailsUrl: "u",
				},
				idempotencyKey: `check:${sha}:block`,
			},
		]);
		for (const row of blockRows) {
			await runServices.markActionExecuted(db, row.id, "done");
		}

		const fake = fakeAdapter();
		const result = await sweepActions(
			{
				db,
				adapterFor: () => Promise.resolve(fake.adapter as never),
				logger,
				appUrl: "http://localhost:3000",
			},
			{ recordedBefore: FUTURE(), giveUpBefore: PAST() },
		);
		expect(result.superseded).toBe(2);
		expect(fake.executed).toEqual([]);
		const statuses = await actionStatuses(runId);
		expect(statuses["comment:2:needs_review"]).toBe("superseded");
		expect(statuses[`check:${sha}:needs_review`]).toBe("superseded");
		expect(statuses["comment:2:block"]).toBe("executed");
	});
});

describe("comment ownership (§6 — decide older run after newer)", () => {
	test("older run's comment superseded, its check updates, newer comment stands", async () => {
		const base = normalizedEventSchema.parse(
			await Bun.file(
				new URL(
					"../../../packages/core/fixtures/change-request.opened.event.json",
					import.meta.url,
				).pathname,
			).json(),
		) as NormalizedEvent & {
			repo: { fullName: string };
			changeRequest: { number: number; headSha: string };
		};
		const eventFor = (sha: string): NormalizedEvent =>
			({
				...base,
				repo: { ...base.repo, fullName: "acme/own" },
				changeRequest: { ...base.changeRequest, number: 3, headSha: sha },
			}) as NormalizedEvent;

		const shaA = "1".repeat(40);
		const shaB = "2".repeat(40);
		// Run A is created FIRST (older); run B second (the latest for PR #3).
		const runA = await runServices.createRun(db, {
			eventId: await insertEvent("own-a"),
			repoFullName: "acme/own",
			subjectNumber: 3,
			headSha: shaA,
			snapshot: SNAPSHOT,
			status: "paused",
			verdict: "needs_review",
		});
		await sleep(15);
		const runB = await runServices.createRun(db, {
			eventId: await insertEvent("own-b"),
			repoFullName: "acme/own",
			subjectNumber: 3,
			headSha: shaB,
			snapshot: SNAPSHOT,
			status: "completed",
			verdict: "block",
		});

		const fake = fakeAdapter();
		const deps = {
			db,
			adapter: fake.adapter as never,
			logger,
			appUrl: "https://tripwire.sh",
		};
		// B (the latest) posts its comment normally.
		await emitPrSurface(deps, {
			runId: runB,
			verdict: "block",
			event: eventFor(shaB),
			reasons: [{ text: "your account is 2 days old", remedy: "wait" }],
			pendingActionRows: [],
		});
		// A (older) resolves LATER — its comment must NOT overwrite B's.
		await emitPrSurface(deps, {
			runId: runA,
			verdict: "pass",
			event: eventFor(shaA),
			reasons: [],
			pendingActionRows: [],
		});

		const aStatuses = await actionStatuses(runA);
		expect(aStatuses["comment:3:pass"]).toBe("superseded");
		expect(aStatuses[`check:${shaA}:pass`]).toBe("executed");
		const bStatuses = await actionStatuses(runB);
		expect(bStatuses["comment:3:block"]).toBe("executed");

		// exactly one comment reached the forge — B's block, never A's pass.
		const comments = fake.executed.filter((e) => e.kind === "comment");
		expect(comments).toHaveLength(1);
		expect(comments[0]?.detail).toContain(
			"Tripwire now blocks this change request.",
		);
	});
});

describe("a comment run's own reply", () => {
	test("is executed, not superseded by the change request's latest run", async () => {
		const commentRun = await runServices.createRun(db, {
			eventId: await insertEvent("reply-comment", "comment.created"),
			repoFullName: "acme/reply",
			subjectNumber: 4,
			headSha: null,
			snapshot: SNAPSHOT,
			status: "completed",
			verdict: "pass",
		});
		await runServices.recordActions(db, commentRun, [
			{
				kind: "comment",
				payload: { number: 4, body: "thanks for the ping" },
				idempotencyKey: "reply:4",
			},
		]);
		await sleep(15);
		await runServices.createRun(db, {
			eventId: await insertEvent("reply-push"),
			repoFullName: "acme/reply",
			subjectNumber: 4,
			headSha: "4".repeat(40),
			snapshot: SNAPSHOT,
			status: "completed",
			verdict: "block",
		});

		const fake = fakeAdapter();
		await sweepActions(
			{
				db,
				adapterFor: () => Promise.resolve(fake.adapter as never),
				logger,
				appUrl: "http://localhost:3000",
			},
			{ recordedBefore: FUTURE(), giveUpBefore: PAST() },
		);
		expect((await actionStatuses(commentRun))["reply:4"]).toBe("executed");
	});
});

test("retry dispatch uses the event forge even when both repos have the same name", async () => {
	const { repoServices } = await import("@tripwire/db");
	const { generateId } = await import("@tripwire/utils");
	const fullName = "same-owner/retry-target";
	for (const forge of ["github", "opengit"] as const) {
		await repoServices.ensureRepo(db, {
			forge,
			externalId: generateId(),
			owner: "same-owner",
			name: "retry-target",
			fullName,
		});
	}
	const deliveryId = generateId();
	const inserted = await eventServices.insertRawEvent(pool, boss, {
		forge: "opengit",
		deliveryId,
		rawKind: "database-isolation-test",
		raw: {},
	});
	if (!inserted.eventId) {
		throw new Error("missing event");
	}
	const runId = await runServices.createRun(db, {
		eventId: inserted.eventId,
		repoFullName: fullName,
		subjectNumber: 99,
		headSha: "same-head",
		snapshot: SNAPSHOT,
		status: "completed",
		verdict: "pass",
	});
	await runServices.recordActions(db, runId, [
		{
			kind: "label",
			payload: { number: 99, labels: ["checked"] },
			idempotencyKey: "label",
		},
	]);
	const fake = fakeAdapter();
	const routed: { name: string; forge: string }[] = [];
	await sweepActions(
		{
			db,
			appUrl: "https://tripwire.sh",
			logger,
			adapterFor: (name, forge) => {
				routed.push({ name, forge });
				return Promise.resolve(fake.adapter);
			},
		},
		{ recordedBefore: FUTURE(), giveUpBefore: new Date(0) },
	);
	expect(routed.filter((route) => route.name === fullName)).toEqual([
		{ name: fullName, forge: "opengit" },
	]);
	expect(
		fake.executed.filter((action) => action.kind === "label"),
	).toHaveLength(1);
});
