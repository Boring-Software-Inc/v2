import type { PgBoss, WorkHandler, WorkOptions } from "pg-boss";
import type { Logger } from "pino";

/**
 * Raises how many jobs this worker runs at once while a queue backs up, and
 * lowers it once the queue drains. Evaluations mostly wait on GitHub and the
 * AI model, so one process can run many at once; Unkey only scales replicas
 * on CPU, which an I/O-bound worker never reaches.
 *
 * The signal is the age of the oldest ready job, not the count: 500 quick
 * jobs are fine, one job waiting five minutes is not.
 */
export interface ConcurrencyScalerOptions<T> {
	boss: PgBoss;
	queue: string;
	handler: WorkHandler<T>;
	/** Options every registration shares (lanes, burst). */
	workOptions: WorkOptions;
	/** Seconds the oldest ready job has waited; 0 when none is ready. */
	oldestReadyAgeSeconds(): Promise<number>;
	logger: Logger;
	min: number;
	max: number;
	/** Scale up while the oldest ready job is older than this. */
	targetWaitSeconds: number;
	intervalMs?: number;
}

export interface ConcurrencyScaler {
	concurrency(): number;
	stop(): Promise<void>;
}

/** Consecutive idle ticks before giving back one step. */
const IDLE_TICKS_TO_SHRINK = 3;

/** Evaluation slots per step: the floor, and what each scale-up adds. */
export const EVALUATE_CONCURRENCY_STEP = 4;

/**
 * The ceiling, from `EVALUATE_CONCURRENCY_MAX` (default 16, rounded down to a
 * whole step). Handlers share the worker's 10-connection database pool, and
 * mostly wait on GitHub and the model, so slots past the pool size queue
 * briefly for a connection rather than failing.
 */
export function evaluateConcurrencyMax(
	env: Record<string, string | undefined> = process.env,
): number {
	const raw = Number(env.EVALUATE_CONCURRENCY_MAX);
	const max = Number.isFinite(raw) && raw > 0 ? raw : 16;
	return Math.max(
		EVALUATE_CONCURRENCY_STEP,
		Math.floor(max / EVALUATE_CONCURRENCY_STEP) * EVALUATE_CONCURRENCY_STEP,
	);
}

export async function startConcurrencyScaler<T>(
	options: ConcurrencyScalerOptions<T>,
): Promise<ConcurrencyScaler> {
	const { boss, queue, logger, min, max } = options;
	// Each registration adds `min` slots, so capacity moves in steps of `min`.
	const registrations: string[] = [];
	const register = async () => {
		registrations.push(
			await boss.work<T>(
				queue,
				{ ...options.workOptions, localConcurrency: min },
				options.handler,
			),
		);
	};
	await register();

	let idleTicks = 0;
	let ticking = false;
	const tick = async () => {
		if (ticking) return;
		ticking = true;
		try {
			const age = await options.oldestReadyAgeSeconds();
			const current = registrations.length * min;
			if (age > options.targetWaitSeconds && current + min <= max) {
				idleTicks = 0;
				await register();
				logger.info(
					{ queue, concurrency: current + min, oldestReadyAgeSeconds: age },
					"queue backing up: raised concurrency",
				);
			} else if (age === 0 && registrations.length > 1) {
				idleTicks++;
				if (idleTicks >= IDLE_TICKS_TO_SHRINK) {
					idleTicks = 0;
					const id = registrations.pop();
					// Stops fetching; jobs it already holds finish.
					if (id) await boss.offWork(queue, { id, wait: false });
					logger.info(
						{ queue, concurrency: current - min },
						"queue drained: lowered concurrency",
					);
				}
			} else idleTicks = 0;
		} catch (error) {
			logger.warn({ queue, error }, "concurrency scaler tick failed");
		} finally {
			ticking = false;
		}
	};
	const timer = setInterval(tick, options.intervalMs ?? 15_000);

	return {
		concurrency: () => registrations.length * min,
		stop: async () => {
			clearInterval(timer);
			for (const id of registrations.splice(0))
				await boss.offWork(queue, { id, wait: false });
		},
	};
}
