import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	DEFAULT_WORKFLOW,
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import type { ForgeAction } from "@tripwire/forge";
import { generateId } from "@tripwire/utils";
import type { Pool } from "pg";
import pino from "pino";
import { deliverWebhooks } from "./jobs/deliver-webhook.ts";
import { emitPrSurface } from "./jobs/pr-surface.ts";

/**
 * Regression test for the thread-path delivery bug: `emitThreadActions`
 * (comment.created / schedule.matched) attached delivery payloads only to
 * `webhook` rows and skipped only `webhook` rows during forge execution, so
 * `discord` rows were left without a payload AND mis-executed as `block`
 * forge actions (or abandoned as malformed by the delivery cron). The fix
 * mirrors the PR path — both kinds get a payload and both are skipped during
 * forge execution.
 */

let container: TestDatabase;
let db: Db;
let pool: Pool;
const logger = pino({ level: "silent" });
const REPO = "acme/discord-thread";

const NOW = "2026-11-07T12:00:00.000Z";

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await repoServices.ensureRepo(db, {
		externalId: "1",
		owner: "acme",
		name: "discord-thread",
		fullName: REPO,
	});
}, 120_000);

afterEach(async () => {
	await pool.query("DELETE FROM run_actions");
	await pool.query("DELETE FROM runs");
	await pool.query("DELETE FROM events");
});

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

function commentCreatedEvent(number: number): NormalizedEvent {
	return normalizedEventSchema.parse({
		id: generateId(),
		forge: "github",
		deliveryId: `comment-${number}`,
		repo: { owner: "acme", name: "discord-thread", fullName: REPO },
		actor: { login: "drive-by", externalId: "42" },
		occurredAt: NOW,
		receivedAt: NOW,
		kind: "comment.created",
		comment: {
			externalId: "c1",
			body: "hello",
			url: `https://github.com/${REPO}/issues/${number}#issuecomment-1`,
			subjectNumber: number,
		},
	});
}

function scheduleMatchedEvent(number: number): NormalizedEvent {
	return normalizedEventSchema.parse({
		id: generateId(),
		forge: "github",
		deliveryId: `schedule-${number}`,
		repo: { owner: "acme", name: "discord-thread", fullName: REPO },
		actor: { login: "scheduler", externalId: "42" },
		occurredAt: NOW,
		receivedAt: NOW,
		kind: "schedule.matched",
		schedule: { workflowId: "wf-discord", nodeId: "nightly", tickId: "tick-1" },
		thread: {
			kind: number % 2 === 0 ? "change-request" : "issue",
			number,
			title: "stale thread",
			url: `https://github.com/${REPO}/issues/${number}`,
			state: "open",
			author: "someone",
			labels: [],
			locked: false,
			updatedAt: "2026-10-01T00:00:00.000Z",
		},
	});
}

interface SeededRun {
	runId: string;
	rows: Awaited<ReturnType<typeof runServices.recordActions>>;
}

async function seedRunWithDeliveries(
	event: NormalizedEvent,
	subjectNumber: number,
	kinds: ("webhook" | "discord")[],
): Promise<SeededRun> {
	const eventId = event.id;
	await pool.query(
		`INSERT INTO events (id, delivery_id, raw_kind, raw) VALUES ($1, $2, $3, $4)`,
		[eventId, event.deliveryId, "pull_request", "{}"],
	);
	const runId = await runServices.createRun(db, {
		eventId,
		repoFullName: REPO,
		subjectNumber,
		headSha: null,
		snapshot: [DEFAULT_WORKFLOW],
		status: "completed",
		verdict: "block",
	});
	const rows = await runServices.recordActions(
		db,
		runId,
		kinds.map((kind) => ({
			kind,
			payload: { url: `https://${kind}.example/webhook` },
			idempotencyKey: `${kind}:${runId}`,
		})),
	);
	return { runId, rows };
}

async function actionRow(actionId: string): Promise<{
	status: string;
	payload: Record<string, unknown>;
}> {
	const res = await pool.query<{
		status: string;
		payload: Record<string, unknown>;
	}>("SELECT status, payload FROM run_actions WHERE id = $1", [actionId]);
	return res.rows[0] ?? { status: "missing", payload: {} };
}

describe("thread-path delivery: discord rows are delivered, not mis-executed", () => {
	test("comment.created — discord row gets a payload, is not executed as a block, and is delivered", async () => {
		const event = commentCreatedEvent(7);
		const { runId, rows } = await seedRunWithDeliveries(event, 7, [
			"discord",
			"webhook",
		]);
		const discordRow = rows.find((r) => r.kind === "discord");
		const webhookRow = rows.find((r) => r.kind === "webhook");
		if (!discordRow || !webhookRow) throw new Error("missing delivery row");

		const executed: ForgeAction[] = [];
		const adapter = {
			forge: "github" as const,
			verifyWebhook: () => true,
			normalizeWebhook: () => null,
			getDiff: () => Promise.resolve([]),
			getCommits: () => Promise.resolve([]),
			readFile: () => Promise.resolve(null),
			getContributorProfile: () => Promise.reject(new Error("unused")),
			execute: (action: ForgeAction) => {
				executed.push(action);
				return Promise.resolve({ externalId: null });
			},
		};

		await emitPrSurface(
			{ db, adapter: adapter as never, logger, appUrl: "https://tripwire.sh" },
			{
				runId,
				verdict: "block",
				event,
				reasons: [{ text: "account is new", remedy: "revise" }],
				pendingActionRows: rows,
			},
		);

		// Both delivery rows got a payload attached — neither was left bare.
		const discordAfter = await actionRow(discordRow.id);
		const webhookAfter = await actionRow(webhookRow.id);
		expect(discordAfter.payload.delivery).toBeDefined();
		expect(webhookAfter.payload.delivery).toBeDefined();
		expect(discordAfter.status).toBe("recorded");
		expect(webhookAfter.status).toBe("recorded");

		// No forge action was executed for the delivery rows — in particular
		// no bogus REQUEST_CHANGES block review was posted.
		expect(executed).toEqual([]);
		expect(
			executed.some((a) => a.kind === "block" || a.kind === "update-review"),
		).toBe(false);

		// The delivery cron delivers both.
		let fetchCalls = 0;
		const result = await deliverWebhooks({
			db,
			logger,
			guardDeps: {
				lookupImpl: async () => [{ address: "8.8.8.8" }],
				fetchImpl: (async () => {
					fetchCalls++;
					return new Response(null, { status: 200 });
				}) as unknown as typeof fetch,
			},
		});
		expect(fetchCalls).toBe(2);
		expect(result.delivered).toBe(2);
		expect(result.abandoned).toBe(0);
		expect((await actionRow(discordRow.id)).status).toBe("executed");
		expect((await actionRow(webhookRow.id)).status).toBe("executed");
	});

	test("comment.created — without forge credentials, discord row stays recorded and is delivered by the cron", async () => {
		const event = commentCreatedEvent(8);
		const { runId, rows } = await seedRunWithDeliveries(event, 8, ["discord"]);
		const discordRow = rows.find((r) => r.kind === "discord");
		if (!discordRow) throw new Error("no discord row");

		await emitPrSurface(
			{ db, adapter: null, logger, appUrl: "https://tripwire.sh" },
			{
				runId,
				verdict: "block",
				event,
				reasons: [],
				pendingActionRows: rows,
			},
		);

		// The payload was attached even with no adapter.
		const after = await actionRow(discordRow.id);
		expect(after.payload.delivery).toBeDefined();
		expect(after.status).toBe("recorded");

		// The cron delivers it — it is NOT abandoned as malformed.
		const result = await deliverWebhooks({
			db,
			logger,
			guardDeps: {
				lookupImpl: async () => [{ address: "8.8.8.8" }],
				fetchImpl: (async () =>
					new Response(null, { status: 200 })) as unknown as typeof fetch,
			},
		});
		expect(result.delivered).toBe(1);
		expect(result.abandoned).toBe(0);
		expect((await actionRow(discordRow.id)).status).toBe("executed");
	});

	test("schedule.matched — discord row gets a payload, is not executed as a block, and is delivered", async () => {
		const event = scheduleMatchedEvent(9);
		const { runId, rows } = await seedRunWithDeliveries(event, 9, ["discord"]);
		const discordRow = rows.find((r) => r.kind === "discord");
		if (!discordRow) throw new Error("no discord row");

		const executed: ForgeAction[] = [];
		const adapter = {
			forge: "github" as const,
			verifyWebhook: () => true,
			normalizeWebhook: () => null,
			getDiff: () => Promise.resolve([]),
			getCommits: () => Promise.resolve([]),
			readFile: () => Promise.resolve(null),
			getContributorProfile: () => Promise.reject(new Error("unused")),
			execute: (action: ForgeAction) => {
				executed.push(action);
				return Promise.resolve({ externalId: null });
			},
		};

		await emitPrSurface(
			{ db, adapter: adapter as never, logger, appUrl: "https://tripwire.sh" },
			{
				runId,
				verdict: "pass",
				event,
				reasons: [],
				pendingActionRows: rows,
			},
		);

		// Payload attached, not executed via forge.
		const after = await actionRow(discordRow.id);
		expect(after.payload.delivery).toBeDefined();
		expect(after.status).toBe("recorded");
		expect(executed).toEqual([]);

		// Delivered by the cron.
		const result = await deliverWebhooks({
			db,
			logger,
			guardDeps: {
				lookupImpl: async () => [{ address: "8.8.8.8" }],
				fetchImpl: (async () =>
					new Response(null, { status: 200 })) as unknown as typeof fetch,
			},
		});
		expect(result.delivered).toBe(1);
		expect(result.abandoned).toBe(0);
		expect((await actionRow(discordRow.id)).status).toBe("executed");
	});

	test("schedule.matched — a non-delivery action (lock) still executes via the forge adapter", async () => {
		// Guards against over-skipping: the fix skips only delivery kinds, not
		// every action on the thread path.
		const event = scheduleMatchedEvent(10);
		const eventId = event.id;
		await pool.query(
			`INSERT INTO events (id, delivery_id, raw_kind, raw) VALUES ($1, $2, $3, $4)`,
			[eventId, event.deliveryId, "pull_request", "{}"],
		);
		const runId = await runServices.createRun(db, {
			eventId,
			repoFullName: REPO,
			subjectNumber: 10,
			headSha: null,
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "pass",
		});
		const [lockRow, discordRow] = await runServices.recordActions(db, runId, [
			{
				kind: "lock",
				payload: { reason: "resolved" },
				idempotencyKey: `lock:${runId}`,
			},
			{
				kind: "discord",
				payload: { url: "https://discord.example/webhook" },
				idempotencyKey: `discord:${runId}`,
			},
		]);
		if (!lockRow || !discordRow) throw new Error("missing action row");
		const rows = [
			{ id: lockRow.id, kind: "lock", payload: lockRow.payload },
			{ id: discordRow.id, kind: "discord", payload: discordRow.payload },
		];

		const executed: ForgeAction[] = [];
		const adapter = {
			forge: "github" as const,
			verifyWebhook: () => true,
			normalizeWebhook: () => null,
			getDiff: () => Promise.resolve([]),
			getCommits: () => Promise.resolve([]),
			readFile: () => Promise.resolve(null),
			getContributorProfile: () => Promise.reject(new Error("unused")),
			execute: (action: ForgeAction) => {
				executed.push(action);
				return Promise.resolve({ externalId: null });
			},
		};

		await emitPrSurface(
			{ db, adapter: adapter as never, logger, appUrl: "https://tripwire.sh" },
			{
				runId,
				verdict: "pass",
				event,
				reasons: [],
				pendingActionRows: rows,
			},
		);

		// The lock executed; the discord row did not.
		expect(executed).toEqual([
			{ kind: "lock", repoFullName: REPO, number: 10, reason: "resolved" },
		]);
		expect((await actionRow(lockRow.id)).status).toBe("executed");
		expect((await actionRow(discordRow.id)).status).toBe("recorded");
		expect((await actionRow(discordRow.id)).payload.delivery).toBeDefined();
	});
});
