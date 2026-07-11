import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	eventServices,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { processEvent } from "./jobs/process-event.ts";

/**
 * §11 integration — the worker half of the §5 pipeline on REAL postgres:
 * raw event → normalize → normalized cols + jsonb written → NOTIFY 'events'
 * observed by a dedicated LISTEN connection. Malformed payload ⇒ quarantined,
 * raw untouched. Re-processing a normalized event is a no-op.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;
const logger = pino({ level: "silent" });

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true });
	await pool?.end();
	await container?.stop();
});

async function fixtureRaw(): Promise<unknown> {
	const path = new URL(
		"../../../packages/forge-github/fixtures/pull_request.opened.json",
		import.meta.url,
	).pathname;
	return await Bun.file(path).json();
}

describe("processEvent", () => {
	test("normalizes, writes cols + jsonb, and NOTIFYs 'events'", async () => {
		const listener = await pool.connect();
		const notifications: string[] = [];
		listener.on("notification", (msg) => {
			if (msg.payload) {
				notifications.push(msg.payload);
			}
		});
		await listener.query("LISTEN events");

		const raw = await fixtureRaw();
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-d1",
			rawKind: "pull_request",
			raw,
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent({ db, pool, logger }, { eventId });

		const row = await pool.query(
			"SELECT kind, repo_full_name, actor_login, subject_number, head_sha, normalized, quarantined FROM events WHERE id = $1",
			[eventId],
		);
		expect(row.rows[0].kind).toBe("change-request.opened");
		expect(row.rows[0].repo_full_name).toContain("/");
		expect(row.rows[0].subject_number).toBeGreaterThan(0);
		expect(row.rows[0].head_sha).toMatch(/^[0-9a-f]{40}$/);
		expect(row.rows[0].quarantined).toBe(false);
		expect(row.rows[0].normalized.kind).toBe("change-request.opened");

		const deadline = Date.now() + 5000;
		while (notifications.length === 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 50));
		}
		expect(notifications).toContain(eventId);

		await listener.query("UNLISTEN events");
		listener.release();
	});

	test("re-processing a normalized event is a no-op", async () => {
		const row = await pool.query(
			"SELECT id, normalized_at FROM events WHERE delivery_id = $1",
			["worker-d1"],
		);
		const before = row.rows[0].normalized_at;
		await processEvent({ db, pool, logger }, { eventId: row.rows[0].id });
		const after = await pool.query(
			"SELECT normalized_at FROM events WHERE id = $1",
			[row.rows[0].id],
		);
		expect(after.rows[0].normalized_at.getTime()).toBe(before.getTime());
	});

	test("malformed ingested payload ⇒ quarantined, raw untouched", async () => {
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-d2",
			rawKind: "pull_request",
			raw: { action: "opened", nonsense: true },
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent({ db, pool, logger }, { eventId });
		const row = await pool.query(
			"SELECT quarantined, quarantine_reason, raw, normalized FROM events WHERE id = $1",
			[eventId],
		);
		expect(row.rows[0].quarantined).toBe(true);
		expect(row.rows[0].quarantine_reason.length).toBeGreaterThan(0);
		expect(row.rows[0].raw).toEqual({ action: "opened", nonsense: true });
		expect(row.rows[0].normalized).toBeNull();
	});

	test("non-ingested kind (ping) stays un-normalized, not quarantined", async () => {
		const pingPath = new URL(
			"../../../packages/forge-github/fixtures/ping.json",
			import.meta.url,
		).pathname;
		const { eventId } = await eventServices.insertRawEvent(pool, boss, {
			deliveryId: "worker-d3",
			rawKind: "ping",
			raw: await Bun.file(pingPath).json(),
		});
		if (!eventId) {
			throw new Error("insert failed");
		}
		await processEvent({ db, pool, logger }, { eventId });
		const row = await pool.query(
			"SELECT normalized_at, quarantined FROM events WHERE id = $1",
			[eventId],
		);
		expect(row.rows[0].normalized_at).toBeNull();
		expect(row.rows[0].quarantined).toBe(false);
	});
});
