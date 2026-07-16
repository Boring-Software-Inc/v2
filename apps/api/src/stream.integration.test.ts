import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Auth } from "@tripwire/auth/server";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createApi } from "./index.ts";

/**
 * The SSE gate: dashboard data is session-gated; dev open posture (auth null)
 * keeps the stream usable; the webhook route's auth remains its HMAC. The
 * session boundary is OUR seam — better-auth's cookie internals are not under
 * test, so getSession is faked at the Auth surface.
 */
let container: TestDatabase;
let db: Db;
let pool: Pool;
let boss: PgBoss;

function fakeAuth(session: { user: { id: string } } | null): Auth {
	return {
		api: {
			getSession: () => Promise.resolve(session),
		},
	} as unknown as Auth;
}

function makeApp(auth: Auth | null) {
	return createApi({
		auth,
		db,
		pool,
		// No pooler in the testcontainer, so the same pool holds the LISTEN.
		directPool: pool,
		boss,
		webhookSecret: "s",
		webOrigin: "http://localhost:3000",
		logger: pino({ level: "silent" }),
	});
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	// Hermetic gate state: assertApproved reads accessStatus fresh from the
	// DB, and the Databuddy access-gate flag can resolve LIVE (on) in tests —
	// so the "valid session" case must be an APPROVED user row, not a phantom
	// id that falls back to "pending" and 403s whenever the network flag is up.
	await db.insert(schema.user).values({
		id: "u1",
		name: "approved tester",
		email: "u1@example.com",
		accessStatus: "approved",
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function firstChunk(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error("no body");
	}
	const { value } = await reader.read();
	await reader.cancel();
	return new TextDecoder().decode(value);
}

describe("GET /events/stream gate", () => {
	test("no session ⇒ 401, nothing streamed", async () => {
		const res = await makeApp(fakeAuth(null)).request("/events/stream");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "session required" });
	});

	test("valid session ⇒ 200 and the stream heartbeats", async () => {
		const res = await makeApp(fakeAuth({ user: { id: "u1" } })).request(
			"/events/stream",
		);
		expect(res.status).toBe(200);
		expect(await firstChunk(res)).toContain("event: heartbeat");
	});

	test("dev open posture (auth null) ⇒ stream stays usable", async () => {
		const res = await makeApp(null).request("/events/stream");
		expect(res.status).toBe(200);
		expect(await firstChunk(res)).toContain("event: heartbeat");
	});

	test("webhook route is untouched by the gate (its auth is HMAC)", async () => {
		const res = await makeApp(fakeAuth(null)).request("/webhooks/github", {
			method: "POST",
			headers: {
				"x-github-delivery": "d",
				"x-github-event": "pull_request",
				"x-hub-signature-256": "sha256=bad",
			},
			body: "{}",
		});
		expect(res.status).toBe(401);
		const health = await makeApp(fakeAuth(null)).request("/healthz");
		expect(health.status).toBe(200);
	});
});
