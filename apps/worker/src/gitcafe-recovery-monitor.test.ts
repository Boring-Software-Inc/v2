import { expect, test } from "bun:test";
import pino from "pino";
import { createGitCafeRecoveryMonitor } from "./gitcafe-recovery-monitor.ts";

const logger = pino({ level: "silent" });

test("readiness requires both registered recovery stages and expires even with empty queues", async () => {
	let now = 200_000;
	let heartbeats = 0;
	const monitor = createGitCafeRecoveryMonitor(
		logger,
		() => now,
		async () => {
			heartbeats++;
		},
	);
	expect(monitor.healthy()).toBe(false);
	await monitor.run("protection", async () => 0);
	await monitor.run("lifecycle", async () => 0);
	expect(monitor.healthy()).toBe(false);
	monitor.registered();
	expect(monitor.healthy()).toBe(true);
	monitor.degrade();
	expect(monitor.healthy()).toBe(false);
	now += 30_000;
	await monitor.run("protection", async () => 0);
	await monitor.run("lifecycle", async () => 0);
	expect(monitor.healthy()).toBe(true);
	expect(heartbeats).toBeGreaterThan(0);
	now += 91_000;
	expect(monitor.healthy()).toBe(false);
	await monitor.run("protection", async () => 0);
	await monitor.run("lifecycle", async () => 0);
	expect(monitor.healthy()).toBe(true);
	monitor.stop();
	expect(monitor.healthy()).toBe(false);
	expect(monitor.signal.aborted).toBe(true);
});

test("a failed recovery becomes unhealthy and healthy later work restores readiness", async () => {
	const monitor = createGitCafeRecoveryMonitor(logger);
	await monitor.run("protection", async () => 0);
	await monitor.run("lifecycle", async () => 0);
	monitor.registered();
	await expect(
		monitor.run("protection", async () => {
			throw new Error("nested provider body secret");
		}),
	).rejects.toThrow("GitCafe recovery unavailable");
	expect(monitor.healthy()).toBe(false);
	await monitor.run("protection", async () => 0);
	expect(monitor.healthy()).toBe(true);
});

test("a hanging recovery times out without starting overlapping replacements", async () => {
	const monitor = createGitCafeRecoveryMonitor(logger);
	let release: (recovered: number) => void = () => {};
	const pending = monitor.run(
		"protection",
		() =>
			new Promise<number>((resolve) => {
				release = resolve;
			}),
	);
	await expect(pending).rejects.toThrow("GitCafe recovery unavailable");
	expect(monitor.healthy()).toBe(false);
	await expect(monitor.run("protection", async () => 0)).rejects.toThrow(
		"still running",
	);
	release(0);
	await Bun.sleep(1);
	await monitor.run("protection", async () => 0);
}, 25_000);
