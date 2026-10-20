import type { MascotState } from "#/components/mascot/machine";
import type { PoseName } from "#/components/mascot/poses";

export type SpringName = "soft" | "snappy" | "bouncy" | "lazy";

export type Spring = { stiffness: number; damping: number };

const spring = (stiffness: number, ratio: number): Spring => ({
	stiffness,
	damping: 2 * ratio * Math.sqrt(stiffness),
});

export const SPRINGS: Record<SpringName, Spring> = {
	soft: spring(170, 0.92),
	snappy: spring(420, 0.82),
	bouncy: spring(300, 0.42),
	lazy: spring(26, 1),
};

export type Step = { pose: PoseName; ms: number; spring: SpringName };

export type Script = {
	steps: Step[];
	loop?: boolean;
	timeoutMs?: number;
	float: number;
	bobPeriod?: number;
};

const hold = (pose: PoseName, spring: SpringName = "soft"): Step => ({
	pose,
	ms: Number.POSITIVE_INFINITY,
	spring,
});

const step = (pose: PoseName, ms: number, s: SpringName): Step => ({
	pose,
	ms,
	spring: s,
});

export const SCRIPTS: Record<MascotState, Script> = {
	idle: { steps: [hold("rest")], float: 1 },
	blink: { steps: [hold("rest")], float: 1, timeoutMs: 160 },
	look: { steps: [hold("rest")], float: 1 },
	hop: {
		steps: [
			step("anticipation", 170, "soft"),
			step("stretch", 140, "snappy"),
			step("apex", 170, "soft"),
			step("landing", 150, "bouncy"),
			step("settle", 220, "bouncy"),
			hold("rest", "soft"),
		],
		timeoutMs: 1250,
		float: 0,
	},
	poked: {
		steps: [
			step("poke", 140, "snappy"),
			step("tall", 160, "bouncy"),
			hold("rest", "bouncy"),
		],
		timeoutMs: 760,
		float: 0.4,
	},
	happy: {
		steps: [step("bounce", 190, "bouncy"), step("rest", 210, "soft")],
		loop: true,
		timeoutMs: 2000,
		float: 0.3,
	},
	sleepy: { steps: [hold("slump", "lazy")], float: 0.7, bobPeriod: 4.6 },
	talking: {
		steps: [step("chatter", 170, "soft"), step("rest", 190, "soft")],
		loop: true,
		float: 0.6,
	},
	angry: {
		steps: [step("stiff", 900, "snappy"), hold("rest", "soft")],
		timeoutMs: 1800,
		float: 0,
	},
	surprised: {
		steps: [
			step("tall", 420, "bouncy"),
			step("settle", 240, "soft"),
			hold("rest", "soft"),
		],
		timeoutMs: 1200,
		float: 0.3,
	},
	annoyed: {
		steps: [
			step("poke", 110, "snappy"),
			step("stiff", 380, "snappy"),
			hold("rest", "soft"),
		],
		timeoutMs: 900,
		float: 0.2,
	},
	furious: {
		steps: [step("stiff", 2700, "snappy"), hold("rest", "soft")],
		timeoutMs: 3000,
		float: 0,
	},
	sploot: {
		steps: [
			step("anticipation", 160, "soft"),
			step("puddle", 1300, "lazy"),
			step("settle", 300, "bouncy"),
			hold("rest", "soft"),
		],
		timeoutMs: 2300,
		float: 0,
	},
};

export function stepAt(script: Script, ms: number): Step {
	const { steps } = script;
	if (script.loop) {
		const cycle = steps.reduce((sum, s) => sum + s.ms, 0);
		let t = ms % cycle;
		for (const s of steps) {
			if (t < s.ms) {
				return s;
			}
			t -= s.ms;
		}
		return steps[0] as Step;
	}
	let t = ms;
	for (const s of steps) {
		if (t < s.ms) {
			return s;
		}
		t -= s.ms;
	}
	return steps[steps.length - 1] as Step;
}
