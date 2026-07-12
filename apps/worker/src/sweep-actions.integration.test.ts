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

async function insertEvent(deliveryId: string): Promise<string> {
	const { eventId } = await eventServices.insertRawEvent(pool, boss, {
		deliveryId,
		rawKind: "pull_request",
		raw: { action: "opened" },
	});
	if (!eventId) {
		throw new Error("insert failed");
	}
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
			{ db, adapter: fake.adapter as never, logger },
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
			{ db, adapter: fake.adapter as never, logger },
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
		expect(comments[0]?.detail).toContain("blocked");
	});
});
