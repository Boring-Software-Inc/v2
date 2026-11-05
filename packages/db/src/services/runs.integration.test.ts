import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	type JsonValue,
	normalizedEventSchema,
	storedActionPayloadSchema,
	type WebhookPayload,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq, sql } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { runActions } from "../schema/runs.ts";
import { getPendingGitCafeReviewCleanup } from "./gitcafe-actions.ts";
import {
	attachDeliveryPayload,
	createRun,
	getGitCafeEvaluationPhase,
	markActionExecuted,
	markActionInvalid,
	recordActions,
	recordDeliveryFailure,
	recordGitCafeSurfaceActions,
	stampReviewBody,
} from "./runs.ts";

let container: TestDatabase;
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
	container = await createTestDatabase();
	const connection = createDb(container.url);
	db = connection.db;
	close = () => connection.pool.end();
	await applyMigrations(db);
}, 120_000);
afterAll(async () => {
	await close?.();
	await container?.stop();
});

async function seedRun(
	forge: "github" | "gitcafe" = "github",
	withPhase = false,
) {
	const id = generateId();
	const raw = await Bun.file(
		new URL(
			"../../../core/fixtures/change-request.opened.event.json",
			import.meta.url,
		),
	).json();
	const normalized = normalizedEventSchema.parse(raw);
	if (normalized.kind !== "change-request.opened")
		throw new Error("Expected captured change request");
	await db
		.insert(events)
		.values({ id, deliveryId: id, forge, rawKind: "pull_request", raw });
	return createRun(db, {
		eventId: id,
		repoFullName: "history/actions",
		subjectNumber: 2,
		headSha: withPhase ? normalized.changeRequest.headSha : "head",
		snapshot: [DEFAULT_WORKFLOW],
		status: "completed",
		verdict: "block",
	});
}

async function actionById(id: string) {
	const [row] = await db.select().from(runActions).where(eq(runActions.id, id));
	if (!row) throw new Error("missing action");
	return row;
}

const delivery: WebhookPayload = {
	version: 1,
	verdict: "block",
	org: "history",
	repo: "history/actions",
	changeRequest: { number: 2, title: "history", author: "author" },
	firedRules: [],
	runUrl: "https://tripwire.sh/runs/history",
	timestamp: "2026-07-12T00:00:00.000Z",
};

describe("persisted action JSON", () => {
	test("a same-phase GitCafe restamp preserves recorded actions despite JSONB key order", async () => {
		const runId = await seedRun("gitcafe", true);
		const phase = await getGitCafeEvaluationPhase(db, runId);
		if (!phase) throw new Error("missing GitCafe phase");
		const input = {
			kind: "block",
			payload: { reason: "Needs review", extra: { retained: true } },
			idempotencyKey: "same-phase",
		};
		const inserted = await recordGitCafeSurfaceActions(
			db,
			runId,
			phase,
			[input],
			[],
			[],
		);
		const action = inserted?.[0];
		if (!action) throw new Error("missing GitCafe action");
		const before = await actionById(action.id);
		expect(
			storedActionPayloadSchema.parse(before.payload).gitCafePhase,
		).toEqual(phase);
		expect(
			await recordGitCafeSurfaceActions(
				db,
				runId,
				phase,
				[input],
				[action.id],
				[],
			),
		).toEqual([]);
		expect(await actionById(action.id)).toEqual(before);
		expect((await actionById(action.id)).status).toBe("recorded");
	});

	test("valid writes, delivery updates and idempotency retain extra JSON", async () => {
		const runId = await seedRun();
		const payload = {
			url: "https://hook.example/path",
			signingSecret: "server-only",
			extra: [null, { nested: true }],
			...JSON.parse('{"__proto__":{"retained":true}}'),
		};
		const input = { kind: "webhook", payload, idempotencyKey: "stable-key" };
		const [row] = await recordActions(db, runId, [input]);
		if (!row) throw new Error("action not recorded");
		expect(row.payload).toEqual(payload);
		expect(await recordActions(db, runId, [input])).toEqual([]);
		const extraDelivery = {
			...delivery,
			changeRequest: { ...delivery.changeRequest, extra: [true] },
			extra: { nested: null },
		};
		await attachDeliveryPayload(db, row.id, extraDelivery);
		await recordDeliveryFailure(db, row.id, "timeout");
		expect(
			Object.hasOwn(
				storedActionPayloadSchema.parse((await actionById(row.id)).payload),
				"__proto__",
			),
		).toBe(true);
		expect((await actionById(row.id)).payload).toEqual({
			...payload,
			delivery: extraDelivery,
			deliveryFailure: "timeout",
			deliveryAttempts: 1,
		});
		await recordDeliveryFailure(db, row.id, "http-error");
		expect((await actionById(row.id)).payload).toMatchObject({
			deliveryAttempts: 2,
			deliveryFailure: "http-error",
			extra: payload.extra,
		});
	});

	test("malformed JSON mutations are audited without deleting the original value", async () => {
		const runId = await seedRun();
		const malformed: JsonValue[] = [null, false, 12, "scalar", [], ["array"]];
		for (const [index, payload] of malformed.entries()) {
			const id = generateId();
			await db.insert(runActions).values({
				id,
				runId,
				kind: "webhook",
				payload: payload === null ? sql`'null'::jsonb` : payload,
				idempotencyKey: `malformed-${index}`,
			});
			if (index % 3 === 0) await attachDeliveryPayload(db, id, delivery);
			else if (index % 3 === 1) await recordDeliveryFailure(db, id, "timeout");
			else await stampReviewBody(db, id, "review");
			expect(await actionById(id)).toMatchObject({
				status: "superseded",
				payload: { invalidPayload: payload, actionFailure: "invalid-payload" },
			});
		}
	});

	test("invalid audit cannot overwrite an already completed action", async () => {
		const runId = await seedRun();
		const [action] = await recordActions(db, runId, [
			{ kind: "block", payload: { extra: true }, idempotencyKey: "completed" },
		]);
		if (!action) throw new Error("action not recorded");
		await markActionExecuted(db, action.id, "forge-id");
		const completed = await actionById(action.id);
		await markActionInvalid(db, action.id);
		expect(await actionById(action.id)).toEqual(completed);
	});

	test("GitCafe cleanup skips invalid rows independently and preserves valid ordering and JSON", async () => {
		const runId = await seedRun("gitcafe");
		const payload = {
			number: 2,
			reviewId: "review",
			extra: [null, { retained: true }],
		};
		const rows = await recordActions(db, runId, [
			{ kind: "dismiss-review", payload, idempotencyKey: "first" },
			{
				kind: "dismiss-review",
				payload: { number: "invalid", reviewId: "review" },
				idempotencyKey: "invalid",
			},
			{ kind: "dismiss-review", payload, idempotencyKey: "last" },
		]);
		const [first, invalid, last] = rows;
		if (!first || !invalid || !last) throw new Error("missing cleanup intents");
		const valid = await getPendingGitCafeReviewCleanup(db, runId);
		expect(valid.map((row) => row.id)).toEqual([first.id, last.id]);
		expect(valid.map((row) => row.payload)).toEqual([payload, payload]);
		expect(await actionById(invalid.id)).toMatchObject({
			status: "superseded",
			payload: { number: "invalid", actionFailure: "invalid-payload" },
		});
		await markActionExecuted(db, first.id, "completed-review");
		const completed = await actionById(first.id);
		expect(
			(await getPendingGitCafeReviewCleanup(db, runId)).map((row) => row.id),
		).toEqual([last.id]);
		expect(await actionById(first.id)).toEqual(completed);
	});
});
