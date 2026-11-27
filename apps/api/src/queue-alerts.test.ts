import { expect, test } from "bun:test";
import type { Db, QueueHealth } from "@tripwire/db";
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
		readHealth: async () => health,
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
	};
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

test("duration reads like a person wrote it", () => {
	expect(duration(42)).toBe("42s");
	expect(duration(432)).toBe("7m 12s");
	expect(duration(61_200)).toBe("17h 0m");
});
