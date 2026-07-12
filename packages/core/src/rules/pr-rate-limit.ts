import { prRateLimitConfigSchema } from "@tripwire/contracts";
import { z } from "zod";
import { defineRule } from "./define.ts";

const HOUR_MS = 3_600_000;

/**
 * Coefficient of variation of the intervals between timestamps — near-zero
 * means metronome-regular submissions, the spray-bot signature.
 */
function intervalCov(timesMs: number[]): number | null {
	if (timesMs.length < 3) {
		return null;
	}
	const sorted = [...timesMs].sort((a, b) => a - b);
	const intervals: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		intervals.push((sorted[i] as number) - (sorted[i - 1] as number));
	}
	const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
	if (mean === 0) {
		return 0;
	}
	const variance =
		intervals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / intervals.length;
	return Math.sqrt(variance) / mean;
}

/**
 * pr-rate-limit@1 — no more than `maxPerWindow` change requests from the
 * contributor within `windowHours`. Evidence includes the interval CoV that
 * flags spray patterns (§6's example evidence).
 */
export const prRateLimit = defineRule({
	id: "pr-rate-limit",
	version: 1,
	configSchema: prRateLimitConfigSchema,
	resultSchema: z.object({
		count: z.number(),
		maxPerWindow: z.number(),
		windowHours: z.number(),
		intervalCov: z.number().nullable(),
	}),
	evaluate(ctx, config) {
		if (ctx.contributor === null) {
			return { status: "skipped", reason: "contributor profile unavailable" };
		}
		const cutoff = Date.parse(ctx.now) - config.windowHours * HOUR_MS;
		const inWindow = ctx.contributor.recentChangeRequestTimes
			.map((t) => Date.parse(t))
			.filter((t) => !Number.isNaN(t) && t >= cutoff);
		return {
			status: "evaluated",
			passed: inWindow.length <= config.maxPerWindow,
			evidence: {
				count: inWindow.length,
				maxPerWindow: config.maxPerWindow,
				windowHours: config.windowHours,
				intervalCov: intervalCov(inWindow),
			},
		};
	},
	publicEvidence: (e) => ({ count: e.count, intervalCov: e.intervalCov }),
	summarize: (e) =>
		`${e.count} change ${e.count === 1 ? "request" : "requests"} in the window`,
	// A window property — clears as the rate falls back under the limit over time.
	// No waitHint: the evidence carries no per-request timestamps, so the window
	// remainder isn't derivable without leaking the configured windowHours.
	remedy: "wait",
});
