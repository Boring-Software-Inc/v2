import { describe, expect, test } from "bun:test";
import {
	allowedEvents,
	expressionFor,
	MAD_AT,
	MASCOT_EVENTS,
	MASCOT_STATES,
	type MascotEvent,
	type MascotState,
	POKE_WINDOW_MS,
	pokeEvent,
	recentPokes,
	resolvePoke,
	TRANSITIONS,
	transition,
} from "#/components/mascot/machine";
import { SCRIPTS } from "#/components/mascot/scripts";

const cases: [MascotState, MascotEvent, MascotState | null][] = [
	["idle", "HOP", "hop"],
	["idle", "POKE", "poked"],
	["idle", "BLINK", "blink"],
	["idle", "LOOK", "look"],
	["idle", "SLEEP", "sleepy"],
	["idle", "TALK", "talking"],
	["idle", "ANGER", "angry"],
	["idle", "SURPRISE", "surprised"],
	["idle", "CHEER", "happy"],
	["idle", "SPLOOT", "sploot"],
	["idle", "WAKE", null],
	["idle", "TIMEOUT", null],
	["blink", "TIMEOUT", "idle"],
	["blink", "LOOK", "look"],
	["look", "LOOK_AWAY", "idle"],
	["look", "BLINK", "blink"],
	["look", "HOP", "hop"],
	["hop", "TIMEOUT", "idle"],
	["hop", "HOP", null],
	["hop", "POKE", null],
	["poked", "POKE", "poked"],
	["poked", "TIMEOUT", "idle"],
	["happy", "TIMEOUT", "idle"],
	["happy", "CHEER", "happy"],
	["sleepy", "WAKE", "idle"],
	["sleepy", "POKE", "surprised"],
	["sleepy", "HOP", null],
	["sleepy", "TIMEOUT", null],
	["talking", "STOP_TALK", "idle"],
	["talking", "TALK", null],
	["talking", "TIMEOUT", null],
	["angry", "POKE", "angry"],
	["angry", "TIMEOUT", "idle"],
	["surprised", "TIMEOUT", "idle"],
	["sploot", "TIMEOUT", "idle"],
	["sploot", "HOP", null],
];

describe("mascot transition", () => {
	test.each(cases)("%s + %s", (state, event, next) => {
		expect(transition(state, event)).toBe(next);
	});

	test("every target is a known state", () => {
		for (const state of MASCOT_STATES) {
			for (const next of Object.values(TRANSITIONS[state])) {
				expect(MASCOT_STATES).toContain(next);
			}
		}
	});

	test("every state can get back to idle", () => {
		for (const state of MASCOT_STATES) {
			const seen = new Set<MascotState>([state]);
			const queue: MascotState[] = [state];
			while (queue.length) {
				const current = queue.shift() as MascotState;
				for (const event of MASCOT_EVENTS) {
					const next = transition(current, event);
					if (next && !seen.has(next)) {
						seen.add(next);
						queue.push(next);
					}
				}
			}
			expect(seen.has("idle")).toBe(true);
		}
	});

	test("timed states leave on TIMEOUT and untimed states ignore it", () => {
		for (const state of MASCOT_STATES) {
			const timed = SCRIPTS[state].timeoutMs !== undefined;
			expect(transition(state, "TIMEOUT") !== null).toBe(timed);
		}
	});

	test("allowed events match the table", () => {
		expect(allowedEvents("sleepy")).toEqual([
			"POKE",
			"WAKE",
			"SURPRISE",
			"ANNOY",
			"TANTRUM",
		]);
		expect(allowedEvents("hop")).toEqual(["TIMEOUT"]);
	});

	test("states pick their face over the resting one", () => {
		expect(expressionFor("idle", "happy")).toBe("happy");
		expect(expressionFor("sleepy", "neutral")).toBe("sleepy");
		expect(expressionFor("poked", "neutral")).toBe("poked");
		expect(expressionFor("talking", "angry")).toBe("talking");
	});
});

describe("poke escalation", () => {
	test("counts escalate poke, annoy, tantrum", () => {
		expect([1, 2, 3, 4, 5, 6].map(pokeEvent)).toEqual([
			"POKE",
			"POKE",
			"ANNOY",
			"ANNOY",
			"TANTRUM",
			"TANTRUM",
		]);
	});

	test("five quick pokes walk idle to furious", () => {
		let state: MascotState = "idle";
		for (let count = 1; count <= MAD_AT; count++) {
			const event = resolvePoke(state, count);
			expect(event).not.toBeNull();
			state = transition(state, event as MascotEvent) as MascotState;
		}
		expect(state).toBe("furious");
	});

	test("the window decays old pokes", () => {
		const times = [0, 500, 1000, 2900];
		expect(recentPokes(times, 3200)).toEqual([500, 1000, 2900]);
		expect(recentPokes(times, 2900 + POKE_WINDOW_MS + 1)).toEqual([]);
	});

	test("furious ignores pokes and cools down on timeout", () => {
		expect(resolvePoke("furious", 1)).toBeNull();
		expect(resolvePoke("furious", MAD_AT)).toBeNull();
		expect(transition("furious", "TIMEOUT")).toBe("idle");
		expect(SCRIPTS.furious.timeoutMs).toBeGreaterThanOrEqual(2000);
		expect(SCRIPTS.furious.timeoutMs).toBeLessThanOrEqual(3500);
	});

	test("states that ignore pokes ignore escalation too", () => {
		expect(resolvePoke("hop", MAD_AT)).toBeNull();
		expect(resolvePoke("sploot", 3)).toBeNull();
	});

	test("annoyed eyes narrow, then turn angry, and furious is angry", () => {
		expect(expressionFor("annoyed", "neutral", 3)).toBe("annoyed");
		expect(expressionFor("annoyed", "neutral", 4)).toBe("angry");
		expect(expressionFor("furious", "happy")).toBe("angry");
	});
});
