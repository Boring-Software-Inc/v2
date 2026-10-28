import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GITCAFE_CONNECT_QUEUE } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { PgBoss } from "pg-boss";

let container: TestDatabase;
let database: ReturnType<typeof createDb>;
const userId = generateId();
const sessionId = generateId();
const orgId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	database = createDb(container.url);
	await applyMigrations(database.db);
	await database.pool.query(
		`INSERT INTO "user" (id, name, email, access_status) VALUES ($1, 'Queue regression', $2, 'approved')`,
		[userId, `${userId}@example.test`],
	);
	await database.pool.query(
		`INSERT INTO session (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
		[sessionId, userId, generateId()],
	);
	await database.pool.query(
		`INSERT INTO organization (id, name, slug, is_personal) VALUES ($1, 'Queue regression', $2, false)`,
		[orgId, `queue-${orgId}`],
	);
	await database.pool.query(
		`INSERT INTO member (id, user_id, organization_id, role) VALUES ($1, $2, $3, 'admin')`,
		[generateId(), userId, orgId],
	);
}, 60_000);

beforeEach(async () => {
	await database.pool.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
	const bootstrap = new PgBoss({
		connectionString: container.url,
		schedule: false,
		supervise: false,
	});
	try {
		await bootstrap.start();
		for (const queue of ["process-event", "resume-run", "stopped-schedule"])
			await bootstrap.createQueue(queue);
		await bootstrap.send("process-event", { eventId: generateId() });
		const active = await bootstrap.send("resume-run", { itemId: generateId() });
		const completed = await bootstrap.send("process-event", {
			eventId: generateId(),
		});
		await database.pool.query(
			`UPDATE pgboss.job SET state = 'active', started_on = now() - interval '1 day', expire_seconds = 1 WHERE id = $1`,
			[active],
		);
		await bootstrap.complete("process-event", completed ?? "", undefined, {
			includeQueued: true,
		});
		await database.pool.query(
			`UPDATE pgboss.job SET keep_until = now() - interval '1 day', completed_on = now() - interval '1 day' WHERE id = $1`,
			[completed],
		);
		await bootstrap.schedule("stopped-schedule", "* * * * *", {
			marker: "must-not-run",
		});
	} finally {
		await bootstrap.stop({ graceful: false });
	}
});

afterAll(async () => {
	await database?.pool.end();
	await container?.stop();
});

async function snapshot() {
	const result = await database.pool.query(
		`SELECT
			(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM pgboss.job j WHERE name <> $1) AS jobs,
			(SELECT jsonb_agg(to_jsonb(q) ORDER BY name) FROM pgboss.queue q WHERE name <> $1) AS queues,
			(SELECT jsonb_agg(to_jsonb(s) ORDER BY name) FROM pgboss.schedule s) AS schedules,
			(SELECT jsonb_agg(to_jsonb(v)) FROM pgboss.version v) AS version,
			(SELECT jsonb_agg(to_jsonb(w)) FROM worker_deployments w) AS deployments,
			(SELECT jsonb_agg(to_jsonb(b)) FROM pgboss.bam b) AS migrations,
			(SELECT jsonb_agg(to_jsonb(w)) FROM pgboss.warning w) AS warnings,
			(SELECT jsonb_agg(to_jsonb(s)) FROM pgboss.queue_stats s) AS stats`,
		[GITCAFE_CONNECT_QUEUE],
	);
	return result.rows;
}

/** Synthetic auth responses isolate queue behavior; they are not provider authority evidence. */
function runWeb(action: "confirm" | "status" | "recover") {
	return spawnSync(
		process.execPath,
		[
			"--no-env-file",
			"--eval",
			`
		import assert from "node:assert/strict";
		import { mock } from "bun:test";
		import { PgBoss } from "pg-boss";
		import { generateId } from "@tripwire/utils";
		const { TEST_USER: userId, TEST_SESSION: sessionId, TEST_ORG: orgId, TEST_ACTION: action } = process.env;
		const current = { user: { id: userId }, session: { id: sessionId } };
		const now = Date.now();
		mock.module("@tanstack/react-start/server", () => ({ setResponseHeader: () => {} }));
		mock.module("@tanstack/start-storage-context", () => ({ getStartContext: () => ({ request: new Request("https://tripwire.test", { headers: { origin: "https://tripwire.test" } }) }) }));
		mock.module("#/lib/server/provider-availability", () => ({ readProviderAvailability: async () => ({ available: ["gitcafe"] }) }));
		mock.module("#/lib/server/auth", () => ({ getAuth: () => ({
			$context: Promise.resolve({ baseURL: "https://tripwire.test" }),
			api: {
				getSession: async () => current,
				consumeGitCafeConnectProof: async () => ({
					userId, sessionId, subject: "queue-subject", actorId: "queue-actor",
					accessToken: "synthetic-queue-test-only", expiresAt: now + 60_000, tokenExpiresAt: now + 60_000,
				}),
			},
		}) }));
		globalThis.fetch = async (url) => Response.json(String(url).endsWith("userinfo")
			? { sub: "queue-subject" }
			: { actorId: "queue-actor", handle: "queue-test", displayName: null, avatarUrl: null });
		const { confirmGitCafeGrant, readGitCafeConnectionStatus } = await import("#/lib/server/gitcafe-connection");
		const { getDb, getGitCafeConnectionBoss } = await import("#/lib/server/db");
		let starts = 0;
		const start = PgBoss.prototype.start;
		PgBoss.prototype.start = function () {
			starts++;
			const { schedule, supervise, migrate, createSchema } = this.getDb().config;
			assert.deepEqual({ schedule, supervise, migrate, createSchema }, { schedule: false, supervise: false, migrate: false, createSchema: false });
			return start.call(this);
		};
		let client;
		try {
			if (action === "recover") {
				assert.deepEqual(await confirmGitCafeGrant(orgId, "queue-installation", "opaque-test-handle"), { ok: false, reason: "queue-unavailable" });
				assert.deepEqual(await readGitCafeConnectionStatus(orgId, "queue-installation", generateId()), { status: "retry" });
				assert.equal(starts, 2);
				const { rows } = await getDb().pool.query("SELECT to_regnamespace('pgboss') AS schema");
				assert.equal(rows[0].schema, null);
				PgBoss.prototype.start = start;
				const bootstrap = new PgBoss({ connectionString: process.env.DATABASE_URL, schedule: false, supervise: false });
				await bootstrap.start();
				await bootstrap.stop({ graceful: false });
				starts = 0;
				PgBoss.prototype.start = function () { starts++; return start.call(this); };
			} else if (action === "status") {
				assert.deepEqual(await readGitCafeConnectionStatus(orgId, "queue-installation", generateId()), { status: "retry" });
			} else {
				const result = await confirmGitCafeGrant(orgId, "queue-installation", "opaque-test-handle");
				assert.equal(result.ok, true);
				assert.deepEqual(await readGitCafeConnectionStatus(orgId, "queue-installation", result.jobId), { status: "pending" });
			}
			const clients = await Promise.all(Array.from({ length: 8 }, () => getGitCafeConnectionBoss(generateId())));
			client = clients[0];
			assert(clients.every((value) => value === client));
			assert.equal(starts, 1);
			assert.deepEqual(client.getWipData(), []);
			if (action === "recover") {
				const { rows } = await getDb().pool.query("SELECT name FROM pgboss.queue ORDER BY name");
				assert.deepEqual(rows, [{ name: "gitcafe-connect" }]);
			}
		} finally {
			await client?.stop({ graceful: false });
			await getDb().pool.end();
		}
		`,
		],
		{
			cwd: fileURLToPath(new URL("../../", import.meta.url)),
			env: {
				NODE_ENV: "test",
				PATH: process.env.PATH,
				DATABASE_URL: container.url,
				TEST_USER: userId,
				TEST_SESSION: sessionId,
				TEST_ORG: orgId,
				TEST_ACTION: action,
			},
			encoding: "utf8",
			timeout: 20_000,
		},
	);
}

for (const action of ["confirm", "status"] as const) {
	test(`web ${action} startup preserves unrelated backlog without general registration or maintenance`, async () => {
		const before = await snapshot();
		const result = runWeb(action);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(await snapshot()).toEqual(before);
		const queues = await database.pool.query(
			"SELECT name FROM pgboss.queue ORDER BY name",
		);
		expect(queues.rows).toEqual([
			{ name: GITCAFE_CONNECT_QUEUE },
			{ name: "process-event" },
			{ name: "resume-run" },
			{ name: "stopped-schedule" },
		]);
	}, 30_000);
}

test("missing queue schema returns bounded failures, never creates it, and permits startup retry", async () => {
	await database.pool.query("DROP SCHEMA pgboss CASCADE");
	const result = runWeb("recover");
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	const logs = result.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(logs).toHaveLength(2);
	expect(logs.map((entry) => entry.error)).toEqual([
		"queue-unavailable",
		"status-failed",
	]);
	for (const entry of logs) {
		expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(Object.keys(entry).sort()).toEqual(
			[
				"level",
				"time",
				"pid",
				"hostname",
				"name",
				"requestId",
				"error",
				"msg",
			].sort(),
		);
	}
}, 30_000);
