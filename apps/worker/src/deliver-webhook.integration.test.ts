import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { createHmac } from "node:crypto";
import type { WebhookPayload } from "@tripwire/contracts";
import { DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	runServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import pino from "pino";
import { deliverWebhooks } from "./jobs/deliver-webhook.ts";

/**
 * §11 integration — proves outbound deliveries route THROUGH `guardedPost` on
 * a REAL postgres, not that the guard works in isolation (its own suite does
 * that). The guard's transport is injected (DNS + socket faked) so the IP
 * classification, header building, and signing all run for real against a live
 * DB row. This test FAILS if the delivery job ever bypasses the guard: a job
 * that called fetch directly would not receive the injected transport, a job
 * that skipped the resolved-IP check would not refuse the blocked case, and a
 * job that regenerated the id per attempt would break the stable-key assertion.
 */

let container: TestDatabase;
let db: Db;
let pool: Pool;
const logger = pino({ level: "silent" });

const SAMPLE_PAYLOAD: WebhookPayload = {
	version: 1,
	verdict: "block",
	org: "acme",
	repo: "acme/web",
	changeRequest: { number: 7, title: "spam", author: "drive-by" },
	firedRules: [
		{ ruleId: "account-age", summary: "your account is 2 days old" },
	],
	runUrl: "https://tripwire.sh/runs/x",
	timestamp: "2026-07-21T00:00:00.000Z",
};

/** Insert an event + run + a recorded webhook action row with its payload. */
async function seedDeliveryRow(input: {
	url: string;
	signingSecret?: string;
	kind?: "webhook" | "discord";
}): Promise<string> {
	const eventId = crypto.randomUUID();
	await pool.query(
		`INSERT INTO events (id, delivery_id, raw_kind, raw) VALUES ($1, $2, $3, $4)`,
		[eventId, crypto.randomUUID(), "pull_request", "{}"],
	);
	const runId = await runServices.createRun(db, {
		eventId,
		repoFullName: "acme/web",
		subjectNumber: 7,
		headSha: "abc",
		snapshot: [DEFAULT_WORKFLOW],
		status: "completed",
		verdict: "block",
	});
	const [row] = await runServices.recordActions(db, runId, [
		{
			kind: input.kind ?? "webhook",
			payload: input.signingSecret
				? { url: input.url, signingSecret: input.signingSecret }
				: { url: input.url },
			idempotencyKey: `${input.kind ?? "webhook"}:${runId}:n1`,
		},
	]);
	if (!row) {
		throw new Error("action row not recorded");
	}
	await runServices.attachDeliveryPayload(db, row.id, SAMPLE_PAYLOAD);
	return row.id;
}

async function actionStatus(actionId: string): Promise<string> {
	const res = await pool.query<{ status: string }>(
		"SELECT status FROM run_actions WHERE id = $1",
		[actionId],
	);
	return res.rows[0]?.status ?? "missing";
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await repoServices.ensureRepo(db, {
		externalId: "1",
		owner: "acme",
		name: "web",
		fullName: "acme/web",
	});
}, 120_000);

// listDeliverableActions is global — clear rows between tests so a leftover
// `recorded` row from one test never bleeds into the next.
afterEach(async () => {
	await pool.query("DELETE FROM run_actions");
	await pool.query("DELETE FROM runs");
	await pool.query("DELETE FROM events");
});

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("webhook delivery — routes through the guard (real DB)", () => {
	test("a blocked destination is refused end to end — no socket opened", async () => {
		const actionId = await seedDeliveryRow({
			url: "https://blocked.example/x",
		});
		let fetchCalls = 0;
		const result = await deliverWebhooks({
			db,
			logger,
			guardDeps: {
				// The host resolves to loopback at delivery — the guard must refuse
				// BEFORE any transport. If the job skipped the resolved-IP check,
				// fetch would be called and this count would be > 0.
				lookupImpl: async () => [{ address: "127.0.0.1" }],
				fetchImpl: (async () => {
					fetchCalls++;
					return new Response(null, { status: 200 });
				}) as unknown as typeof fetch,
			},
		});
		expect(fetchCalls).toBe(0);
		expect(result.delivered).toBe(0);
		expect(result.failed).toBe(1);
		// Not executed — stays recorded to retry (until give-up).
		expect(await actionStatus(actionId)).toBe("recorded");
	});

	test("a valid destination is delivered with the guard's headers + a verifiable signature", async () => {
		const secret = "sign-me";
		const actionId = await seedDeliveryRow({
			url: "https://hook.example/x",
			signingSecret: secret,
		});
		let captured: { body: string; headers: Record<string, string> } | null =
			null;
		const result = await deliverWebhooks({
			db,
			logger,
			guardDeps: {
				lookupImpl: async () => [{ address: "8.8.8.8" }],
				fetchImpl: (async (_url: URL, init: RequestInit) => {
					captured = {
						body: init.body as string,
						headers: init.headers as Record<string, string>,
					};
					return new Response(null, { status: 200 });
				}) as unknown as typeof fetch,
			},
		});
		expect(result.delivered).toBe(1);
		expect(await actionStatus(actionId)).toBe("executed");
		expect(captured).not.toBeNull();
		const cap = captured as unknown as {
			body: string;
			headers: Record<string, string>;
		};
		// The guard built these — a direct fetch would not have them.
		expect(cap.headers["content-type"]).toBe("application/json");
		expect(cap.headers["x-delivery-id"]).toBe(actionId);
		expect(cap.headers["idempotency-key"]).toBe(actionId);
		expect(cap.headers["x-webhook-timestamp"]).toBeDefined();
		// The signature verifies over the EXACT wire body + the header timestamp.
		const sig = /^t=(\d+),v1=([0-9a-f]+)$/.exec(
			cap.headers["x-webhook-signature"] ?? "",
		);
		expect(sig).not.toBeNull();
		const expected = createHmac("sha256", secret)
			.update(`${sig?.[1]}.${cap.body}`)
			.digest("hex");
		expect(sig?.[2]).toBe(expected);
		// The wire body is the sample payload we attached.
		expect(JSON.parse(cap.body).changeRequest.number).toBe(7);
	});

	test("a retry sends the SAME idempotency key (stable = the action row id)", async () => {
		const actionId = await seedDeliveryRow({ url: "https://retry.example/x" });
		const keys: string[] = [];
		let attempt = 0;
		const guardDeps = {
			lookupImpl: async () => [{ address: "8.8.8.8" }],
			fetchImpl: (async (_url: URL, init: RequestInit) => {
				const headers = init.headers as Record<string, string>;
				keys.push(headers["idempotency-key"] ?? "");
				attempt++;
				// Fail the first attempt so the row stays recorded and re-delivers.
				return new Response(null, { status: attempt === 1 ? 500 : 200 });
			}) as unknown as typeof fetch,
		};
		await deliverWebhooks({ db, logger, guardDeps });
		expect(await actionStatus(actionId)).toBe("recorded"); // failed, will retry
		await deliverWebhooks({ db, logger, guardDeps });
		expect(await actionStatus(actionId)).toBe("executed");
		expect(keys).toHaveLength(2);
		expect(keys[0]).toBe(actionId);
		expect(keys[1]).toBe(actionId);
	});

	test("discord delivery carries NO idempotency/signature headers", async () => {
		const actionId = await seedDeliveryRow({
			url: "https://discord.example/webhooks/1/abc",
			kind: "discord",
		});
		let captured: Record<string, string> = {};
		await deliverWebhooks({
			db,
			logger,
			guardDeps: {
				lookupImpl: async () => [{ address: "8.8.8.8" }],
				fetchImpl: (async (_url: URL, init: RequestInit) => {
					captured = init.headers as Record<string, string>;
					return new Response(null, { status: 200 });
				}) as unknown as typeof fetch,
			},
		});
		expect(await actionStatus(actionId)).toBe("executed");
		expect(captured["x-delivery-id"]).toBeUndefined();
		expect(captured["x-webhook-signature"]).toBeUndefined();
		// The body is the Discord message shape, not the raw payload.
		expect(captured["content-type"]).toBe("application/json");
	});
});
