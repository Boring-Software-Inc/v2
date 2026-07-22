import { prRateLimitConfigSchema } from "@tripwire/contracts";
import { atMost, evaluateSignalRule, resolveSignalValue } from "@tripwire/sdk";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
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
 * rule: recentChangeRequestTimes .last(window).count atMost the limit. The
 * evidence count is the exact value the verdict compared, and the CoV runs
 * over the evaluator's own window resolution — no hand-rolled cutoff. The
 * window is capped at the signal's declared history; the producer never
 * returns older data, so the count is unchanged.
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
		const windowed = signals.contributor.recentChangeRequestTimes.last(
			`${cappedHours}h`,
		);
		const requirement = rule("pr rate limit", {
			when: windowed.count,
			comparison: atMost(config.maxPerWindow),
			severity: "high",
		});
		const { passed, resolvedValue } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		// Same resolution the verdict used: the evaluator's window, not a copy.
		const inWindow = resolveSignalValue(windowed.ref, {
			value: read.value,
			now: ctx.now,
		}).value as readonly string[];
		return {
			status: "evaluated",
			passed,
			evidence: {
				// The lastCount transform yields a number by construction.
				count: resolvedValue as number,
				maxPerWindow: config.maxPerWindow,
				windowHours: config.windowHours,
				intervalCov: intervalCov(inWindow.map((time) => Date.parse(time))),
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
