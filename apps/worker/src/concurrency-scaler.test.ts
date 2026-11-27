import { expect, test } from "bun:test";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import {
	EVALUATE_CONCURRENCY_STEP,
	evaluateConcurrencyMax,
	startConcurrencyScaler,
} from "./concurrency-scaler.ts";

function fakeBoss() {
	const active = new Set<string>();
	let next = 0;
	const boss = {
		work: async () => {
			const id = `w${next++}`;
			active.add(id);
			return id;
		},
		offWork: async (_queue: string, options?: { id?: string }) => {
			if (options?.id) active.delete(options.id);
		},
	};
	return { boss: boss as unknown as PgBoss, active };
}

const tick = () => Bun.sleep(30);

test("adds a step while the oldest job waits too long, and gives it back once drained", async () => {
	const { boss, active } = fakeBoss();
	let age = 0;
	const scaler = await startConcurrencyScaler({
		boss,
		queue: "q",
		handler: async () => undefined,
		workOptions: {},
		oldestReadyAgeSeconds: async () => age,
		logger: pino({ level: "silent" }),
		min: 4,
		max: 12,
		targetWaitSeconds: 30,
		intervalMs: 10,
	});
	expect(scaler.concurrency()).toBe(4);

	age = 120;
	await tick();
	await tick();
	expect(scaler.concurrency()).toBe(12);
	await tick();
	// Never past the ceiling.
	expect(scaler.concurrency()).toBe(12);

	age = 0;
	await Bun.sleep(150);
	// The floor registration always stays.
	expect(scaler.concurrency()).toBe(4);
	expect(active.size).toBe(1);

	await scaler.stop();
	expect(active.size).toBe(0);
});

test("evaluateConcurrencyMax reads a whole number of steps from the environment", () => {
	expect(evaluateConcurrencyMax({})).toBe(16);
	expect(evaluateConcurrencyMax({ EVALUATE_CONCURRENCY_MAX: "30" })).toBe(28);
	expect(evaluateConcurrencyMax({ EVALUATE_CONCURRENCY_MAX: "1" })).toBe(
		EVALUATE_CONCURRENCY_STEP,
	);
	expect(evaluateConcurrencyMax({ EVALUATE_CONCURRENCY_MAX: "nope" })).toBe(16);
});
