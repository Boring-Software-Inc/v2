import { captureException } from "@sentry/bun";
import { withTimeout } from "@tripwire/utils";
import type { Logger } from "pino";

export function createGitCafeRecoveryMonitor(
	logger: Logger,
	now: () => number = Date.now,
	onProgress: () => Promise<void> = async () => {},
) {
	const successes = new Map<string, number>();
	const failures = new Set<string>();
	const running = new Map<string, Promise<unknown>>();
	let registered = false;
	let stopped = false;
	let lastReady = false;
	const controller = new AbortController();
	const healthy = () =>
		registered &&
		!stopped &&
		failures.size === 0 &&
		["lifecycle", "protection"].every(
			(stage) =>
				successes.has(stage) && now() - (successes.get(stage) ?? 0) < 90_000,
		);
	const transition = () => {
		const ready = healthy();
		if (ready !== lastReady)
			logger[ready ? "info" : "error"](
				{
					event: "gitcafe.health.transition",
					ready,
					reason: ready ? "recovered" : "recovery-unavailable",
				},
				"GitCafe readiness changed",
			);
		lastReady = ready;
	};
	return {
		signal: controller.signal,
		healthy,
		registered() {
			registered = true;
			transition();
		},
		stop() {
			stopped = true;
			controller.abort();
			transition();
		},
		degrade() {
			failures.add("queue");
			transition();
		},
		async run(stage: "lifecycle" | "protection", work: () => Promise<unknown>) {
			if (stopped) throw new Error("GitCafe recovery stopped");
			if (running.has(stage)) throw new Error("GitCafe recovery still running");
			const started = now();
			const operation = Promise.resolve().then(work);
			running.set(stage, operation);
			void operation.then(
				() => running.delete(stage),
				() => running.delete(stage),
			);
			try {
				const result = await withTimeout(operation, 20_000);
				successes.set(stage, now());
				failures.delete(stage);
				if (
					["lifecycle", "protection"].every(
						(key) => (successes.get(key) ?? 0) >= started - 30_000,
					)
				)
					failures.delete("queue");
				if (healthy()) await withTimeout(onProgress(), 4_000);
				logger.info(
					{
						event: "gitcafe.recovery.succeeded",
						stage,
						durationMs: now() - started,
						recovered: typeof result === "number" ? result : undefined,
					},
					"GitCafe recovery succeeded",
				);
				transition();
			} catch {
				failures.add(stage);
				logger.error(
					{
						event: "gitcafe.recovery.failed",
						stage,
						reason: "recovery-unavailable",
						durationMs: now() - started,
					},
					"GitCafe recovery unavailable",
				);
				captureException(new Error("GitCafe recovery unavailable"), {
					tags: { forge: "gitcafe", stage },
				});
				transition();
				throw new Error("GitCafe recovery unavailable");
			}
		},
	};
}

export type GitCafeRecoveryMonitor = ReturnType<
	typeof createGitCafeRecoveryMonitor
>;
