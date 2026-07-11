import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	PROCESS_EVENT_QUEUE,
	type TestDatabase,
} from "@tripwire/db";
import { signWebhookBody } from "@tripwire/forge-github";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createApi } from "./index.ts";

/**
 * §11 integration layer — REAL Postgres (throwaway container). Never mock Postgres:
 * the tx + UNIQUE(delivery_id) ARE the logic under test. webhook → one tx
 * (insert + pg-boss enqueue) → row + job; same delivery-id twice ⇒ one row,
 * one job; bad signature ⇒ 401 and nothing written.
 */
const SECRET = "integration-secret";

let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
let app: ReturnType<typeof createApi>;

beforeAll(async () => {
	container = await createTestDatabase();
	const url = container.url;
	({ db, pool } = createDb(url));
	await applyMigrations(db);
	boss = await createBoss(url);
	app = createApi({
		db,
		pool,
		boss,
		webhookSecret: SECRET,
		webOrigin: "http://localhost:3000",
		logger: pino({ level: "silent" }),
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true });
	await pool?.end();
	await container?.stop();
});

async function deliver(body: string, deliveryId: string, sign = true) {
	return await app.request("/webhooks/github", {
		method: "POST",
		headers: {
			"x-github-delivery": deliveryId,
			"x-github-event": "pull_request",
			...(sign ? { "x-hub-signature-256": signWebhookBody(body, SECRET) } : {}),
			"content-type": "application/json",
		},
		body,
	});
}

async function fixtureBody(): Promise<string> {
	const path = new URL(
		"../../../packages/forge-github/fixtures/pull_request.opened.json",
		import.meta.url,
	).pathname;
	return await Bun.file(path).text();
}

describe("POST /webhooks/github", () => {
	test("verify → tx(insert + enqueue) → 200; row and job exist", async () => {
		const body = await fixtureBody();
		const res = await deliver(body, "delivery-aaa");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, duplicate: false });

		const rows = await pool.query(
			"SELECT id, raw_kind FROM events WHERE delivery_id = $1",
			["delivery-aaa"],
		);
		expect(rows.rowCount).toBe(1);
		expect(rows.rows[0].raw_kind).toBe("pull_request");

		const jobs = await pool.query(
			"SELECT data FROM pgboss.job WHERE name = $1",
			[PROCESS_EVENT_QUEUE],
		);
		expect(jobs.rowCount).toBe(1);
		expect(jobs.rows[0].data).toEqual({ eventId: rows.rows[0].id });
	});

	test("same delivery-id twice ⇒ still one row, one job, 200 duplicate", async () => {
		const body = await fixtureBody();
		const res = await deliver(body, "delivery-aaa");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, duplicate: true });

		const rows = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE delivery_id = $1",
			["delivery-aaa"],
		);
		expect(rows.rows[0].n).toBe(1);
		const jobs = await pool.query(
			"SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1",
			[PROCESS_EVENT_QUEUE],
		);
		expect(jobs.rows[0].n).toBe(1);
	});

	test("bad signature ⇒ 401, nothing written", async () => {
		const body = await fixtureBody();
		const res = await app.request("/webhooks/github", {
			method: "POST",
			headers: {
				"x-github-delivery": "delivery-bbb",
				"x-github-event": "pull_request",
				"x-hub-signature-256": "sha256=deadbeef",
			},
			body,
		});
		expect(res.status).toBe(401);
		const rows = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE delivery_id = $1",
			["delivery-bbb"],
		);
		expect(rows.rows[0].n).toBe(0);
	});

	test("missing signature ⇒ 401; missing headers ⇒ 400", async () => {
		const body = await fixtureBody();
		const unsigned = await deliver(body, "delivery-ccc", false);
		expect(unsigned.status).toBe(401);
		const noHeaders = await app.request("/webhooks/github", {
			method: "POST",
			body,
		});
		expect(noHeaders.status).toBe(400);
	});
});
