import { prRateLimitConfigSchema } from "@tripwire/contracts";
import { atMost, evaluateSignalRule, windowMs } from "@tripwire/sdk";
import { z } from "zod";
import {
	builtinRule,
	lastCountOf,
	readContextSignal,
} from "./context-forge.ts";
import { defineRule } from "./define.ts";

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

/** The recentChangeRequestTimes signal guarantees 30 days (720h) of history. */
const HISTORY_HOURS = 720;

/**
 * pr-rate-limit@1 — no more than `maxPerWindow` change requests from the
 * contributor within `windowHours`. Evidence includes the interval CoV that
 * flags spray patterns (§6's example evidence). Authored as an SDK signal
 * rule: recentChangeRequestTimes lastCount over the config window, atMost
 * the limit. The window is capped at the signal's declared history; the
 * producer never returns older data, so the count is unchanged.
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
	async evaluate(ctx, config) {
		const read = await readContextSignal(
			"contributor.recentChangeRequestTimes",
			ctx,
		);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const cappedHours = Math.min(config.windowHours, HISTORY_HOURS);
		const window = `${cappedHours}h` as const;
		const requirement = builtinRule("pr rate limit", {
			when: lastCountOf("contributor.recentChangeRequestTimes", window),
			comparison: atMost(config.maxPerWindow),
			severity: "high",
		});
		const { passed } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		// Evidence uses the same cutoff arithmetic as the evaluator's window.
		const cutoff = Date.parse(ctx.now) - windowMs(window);
		const inWindow = read.value
			.map((time) => Date.parse(time))
			.filter((time) => !Number.isNaN(time) && time >= cutoff);
		return {
			status: "evaluated",
			passed,
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
		`you've opened ${e.count} change ${e.count === 1 ? "request" : "requests"} today`,
	// A window property — clears as the rate falls back under the limit over time.
	// No waitHint: the evidence carries no per-request timestamps, so the window
	// remainder isn't derivable without leaking the configured windowHours.
	remedy: "wait",
});
