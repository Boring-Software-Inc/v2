import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	GITHUB_EVALUATE_QUEUE,
	PROCESS_EVENT_QUEUE,
	repoServices,
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
		auth: null,
		db,
		pool,
		directPool: pool,
		boss,
		webhookSecret: SECRET,
		webOrigin: "http://localhost:3000",
		logger: pino({ level: "silent" }),
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function deliver(body: string, deliveryId: string, sign = true) {
	const headers = new Headers({
		"x-github-delivery": deliveryId,
		"x-github-event": "pull_request",
		"content-type": "application/json",
	});
	if (sign) {
		headers.set("x-hub-signature-256", signWebhookBody(body, SECRET));
	}
	return await app.request("/webhooks/github", {
		method: "POST",
		headers,
		body,
	});
}

async function fixtureBody(): Promise<string> {
	// `fileURLToPath`, not `.pathname`: on Windows the latter yields "/C:/..."
	// with a leading slash, which no fs call accepts.
	const path = fileURLToPath(
		new URL(
			"../../../packages/forge-github/fixtures/pull_request.opened.json",
			import.meta.url,
		),
	);
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

	test("queue failure reports webhook correlation context and rolls back", async () => {
		const output: string[] = [];
		const failure = spyOn(boss, "insert").mockRejectedValueOnce(
			new Error("injected queue failure"),
		);
		const target = createApi({
			auth: null,
			db,
			pool,
			directPool: pool,
			boss,
			webhookSecret: SECRET,
			webOrigin: "http://localhost:3000",
			logger: pino(
				{ level: "error" },
				{ write: (chunk: string) => output.push(chunk) },
			),
		});
		try {
			const body = await fixtureBody();
			const headers = new Headers({
				"x-github-delivery": "delivery-failure",
				"x-github-event": "pull_request",
				"x-hub-signature-256": signWebhookBody(body, SECRET),
			});
			const response = await target.request("/webhooks/github", {
				method: "POST",
				headers,
				body,
			});
			expect(response.status).toBe(500);
			const requestId = response.headers.get("x-request-id");
			expect(requestId).toBeString();
			const logged = output.join("");
			expect(logged).toContain("webhook ingest failed");
			expect(logged).toContain("delivery-failure");
			expect(logged).toContain(`"requestId":"${requestId}"`);
		} finally {
			failure.mockRestore();
		}
		const rows = await pool.query(
			"SELECT count(*)::int AS n FROM events WHERE delivery_id = $1",
			["delivery-failure"],
		);
		expect(rows.rows[0].n).toBe(0);
	});
});

test("GitCafe identity alone does not enable a webhook endpoint", async () => {
	const before = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM events",
	);
	const res = await app.request("/webhooks/gitcafe", {
		method: "POST",
		body: "not a payload",
	});
	expect(res.status).toBe(404);
	const after = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM events",
	);
	expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
});

describe("ingest lanes", () => {
	let repoId: string;

	beforeAll(async () => {
		// The pull_request fixtures are scoped to Codertocat/Hello-World.
		repoId = await repoServices.ensureRepo(db, {
			externalId: "186853002",
			owner: "Codertocat",
			name: "Hello-World",
			fullName: "Codertocat/Hello-World",
		});
	});

	async function deliverAs(
		eventName: string,
		body: string,
		deliveryId: string,
	) {
		return await app.request("/webhooks/github", {
			method: "POST",
			headers: {
				"x-github-delivery": deliveryId,
				"x-github-event": eventName,
				"x-hub-signature-256": signWebhookBody(body, SECRET),
			},
			body,
		});
	}

	async function stored(deliveryId: string) {
		const rows = await pool.query<{
			id: string;
			kind: string | null;
			normalized_at: Date | null;
		}>("SELECT id, kind, normalized_at FROM events WHERE delivery_id = $1", [
			deliveryId,
		]);
		const event = rows.rows[0];
		const jobs = event
			? await pool.query<{ name: string; group_id: string | null }>(
					"SELECT name, group_id FROM pgboss.job WHERE data->>'eventId' = $1",
					[event.id],
				)
			: null;
		return { event, jobs: jobs?.rows ?? [] };
	}

	test("a delivery Tripwire never reads is acknowledged and not stored", async () => {
		const res = await deliverAs(
			"check_suite",
			JSON.stringify({ action: "requested" }),
			"lane-ignored",
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, ignored: true });
		expect((await stored("lane-ignored")).event).toBeUndefined();
	});

	test("a PR on a repo with Tripwire off is stored normalized, with no job", async () => {
		await deliverAs("pull_request", await fixtureBody(), "lane-record");
		const { event, jobs } = await stored("lane-record");
		expect(event?.kind).toBe("change-request.opened");
		expect(event?.normalized_at).not.toBeNull();
		expect(jobs).toEqual([]);
	});

	test("a close evaluates even with Tripwire off, to settle open reviews", async () => {
		const body = await Bun.file(
			fileURLToPath(
				new URL(
					"../../../packages/forge-github/fixtures/pull_request.closed.json",
					import.meta.url,
				),
			),
		).text();
		await deliverAs("pull_request", body, "lane-close");
		const { jobs } = await stored("lane-close");
		expect(jobs.map((job) => job.name)).toEqual([GITHUB_EVALUATE_QUEUE]);
	});

	test("a PR on an armed repo queues in its installation's lane", async () => {
		await repoServices.setRepoArmed(db, repoId, true);
		const body = await Bun.file(
			fileURLToPath(
				new URL(
					"../../../packages/forge-github/fixtures/pull_request.synchronize.json",
					import.meta.url,
				),
			),
		).text();
		await deliverAs("pull_request", body, "lane-evaluate");
		await deliverAs(
			"pull_request",
			body.replace('"synchronize"', '"synchronize" '),
			"lane-evaluate-again",
		);
		const first = await stored("lane-evaluate");
		const second = await stored("lane-evaluate-again");
		expect(first.event?.kind).toBe("change-request.updated");
		expect(first.jobs.map((job) => job.name)).toEqual([GITHUB_EVALUATE_QUEUE]);
		expect(first.jobs[0]?.group_id).toStartWith("github:1:");
		// Same PR, same lane: its events run one at a time, in order.
		expect(second.jobs[0]?.group_id).toBe(first.jobs[0]?.group_id);
	});
});
