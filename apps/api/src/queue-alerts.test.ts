import { expect, test } from "bun:test";
import type { Db, QueueHealth } from "@tripwire/db";
import { DatabaseError } from "pg";
import pino from "pino";
import { duration, startQueueAlerts } from "./queue-alerts.ts";

const healthy: QueueHealth = {
	evaluateReady: 0,
	evaluateAgeSeconds: 0,
	processReady: 0,
	processAgeSeconds: 0,
	deadLetteredLastDay: 0,
	lostDeliveriesLastDay: 0,
	workerHeartbeatAgeSeconds: 5,
	connectionsUsed: 6,
	connectionsLimit: 22,
};

/** Stands in for the ops_alerts row: reports a change only when it flips. */
function memoryState() {
	const firing = new Map<string, boolean>();
	return async (_db: Db, key: string, next: boolean) => {
		const previous = firing.get(key);
		firing.set(key, next);
		if (previous === next || (previous === undefined && !next)) return null;
		return { firing: next, sinceSeconds: previous === undefined ? null : 600 };
	};
}

function harness() {
	let health = healthy;
	let refused: Error | null = null;
	const posts: string[] = [];
	const issues: string[] = [];
	const alerts = startQueueAlerts({
		db: {} as Db,
		logger: pino({ level: "silent" }),
		webhookUrl: "https://discord.test/webhook",
		environment: "production",
		post: async (_url, body) => {
			posts.push(body.content);
			return { ok: true };
		},
		capture: (alert) => {
			issues.push(alert.key);
		},
		readHealth: async () => {
			if (refused) throw refused;
			return health;
		},
		recordState: memoryState(),
		intervalMs: 60_000,
	});
	return {
		alerts,
		posts,
		issues,
		set: (next: Partial<QueueHealth>) => {
			health = { ...healthy, ...next };
		},
		refuse: (error: Error | null) => {
			refused = error;
		},
	};
}

/** What drizzle throws when Postgres has no connection slot left. */
function connectionLimitError() {
	const pgError = new DatabaseError(
		"remaining connection slots are reserved for roles with the SUPERUSER attribute",
		137,
		"error",
	);
	pgError.code = "53300";
	return new Error("Failed query", { cause: pgError });
}

test("a backlog pages once after two samples, and again when it clears", async () => {
	const { alerts, posts, set } = harness();
	await alerts.sample();
	set({ evaluateAgeSeconds: 420, evaluateReady: 342 });
	await alerts.sample();
	expect(posts).toEqual([]);
	expect(alerts.snapshot().ok).toBe(true);

	await alerts.sample();
	await alerts.sample();
	expect(posts).toEqual([
		"**FIRING** [production] GitHub PR checks are backing up: the oldest has waited 7m 0s (limit 5m), 342 waiting.",
	]);
	expect(alerts.snapshot()).toMatchObject({
		ok: false,
		firing: ["github-evaluate-backlog"],
	});

	set({});
	await alerts.sample();
	expect(posts.at(-1)).toBe(
		"**RESOLVED** [production] GitHub PR checks are backing up, after 10m 0s.",
	);
	expect(alerts.snapshot().ok).toBe(true);
	alerts.stop();
});

test("a worker that never ran against this database is not down", async () => {
	const { alerts, posts, set } = harness();
	set({ workerHeartbeatAgeSeconds: null });
	await alerts.sample();
	await alerts.sample();
	expect(posts).toEqual([]);
	set({ workerHeartbeatAgeSeconds: 600 });
	await alerts.sample();
	await alerts.sample();
	expect(posts).toEqual([
		"**FIRING** [production] The GitHub worker stopped checking in: last check-in 10m 0s ago (limit 3m).",
	]);
	alerts.stop();
});

test("lost GitHub deliveries page, and every alert opens a Sentry issue", async () => {
	const { alerts, posts, issues, set } = harness();
	await alerts.sample();
	set({ lostDeliveriesLastDay: 2 });
	await alerts.sample();
	await alerts.sample();
	expect(alerts.snapshot().firing).toEqual(["github-deliveries-lost"]);
	expect(posts).toHaveLength(1);
	expect(posts[0]).toContain("GitHub webhooks were never stored");
	expect(issues).toEqual(["github-deliveries-lost"]);
	alerts.stop();
});

test("pages when the database is nearly out of connections", async () => {
	const { alerts, posts, issues, set } = harness();
	await alerts.sample();
	set({ connectionsUsed: 17 });
	await alerts.sample();
	await alerts.sample();
	expect(posts).toEqual([]);

	set({ connectionsUsed: 18 });
	await alerts.sample();
	await alerts.sample();
	expect(posts).toEqual([
		"**FIRING** [production] The database is running out of connections: 18 of 22 in use (limit 80%); new requests fail once none are left.",
	]);
	expect(issues).toEqual(["db-connections-high"]);
	alerts.stop();
});

test("a sample refused a connection pages once, and resolves when one is free", async () => {
	const { alerts, posts, issues, refuse } = harness();
	await alerts.sample();
	refuse(connectionLimitError());
	await alerts.sample();
	expect(alerts.snapshot().ok).toBe(true);

	await alerts.sample();
	await alerts.sample();
	expect(alerts.snapshot()).toMatchObject({
		ok: false,
		firing: ["db-connections-exhausted"],
	});
	expect(issues).toEqual(["db-connections-exhausted"]);
	expect(posts).toEqual([
		"**FIRING** [production] The database refused new connections: the alert sample couldn't connect (Postgres 53300).",
	]);

	refuse(null);
	await alerts.sample();
	expect(alerts.snapshot().ok).toBe(true);
	expect(posts.at(-1)).toBe(
		"**RESOLVED** [production] The database refused new connections.",
	);
	alerts.stop();
});

test("other sample failures only log", async () => {
	const { alerts, posts, issues, refuse } = harness();
	refuse(new Error("network blip"));
	await alerts.sample();
	await alerts.sample();
	await alerts.sample();
	expect(posts).toEqual([]);
	expect(issues).toEqual([]);
	alerts.stop();
});

test("duration reads like a person wrote it", () => {
	expect(duration(42)).toBe("42s");
	expect(duration(432)).toBe("7m 12s");
	expect(duration(61_200)).toBe("17h 0m");
});
