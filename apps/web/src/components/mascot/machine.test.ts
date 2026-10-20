import { describe, expect, test } from "bun:test";
import {
	allowedEvents,
	expressionFor,
	MASCOT_EVENTS,
	MASCOT_STATES,
	type MascotEvent,
	type MascotState,
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
		expect(allowedEvents("sleepy")).toEqual(["POKE", "WAKE", "SURPRISE"]);
		expect(allowedEvents("hop")).toEqual(["TIMEOUT"]);
	});

	test("states pick their face over the resting one", () => {
		expect(expressionFor("idle", "happy")).toBe("happy");
		expect(expressionFor("sleepy", "neutral")).toBe("sleepy");
		expect(expressionFor("poked", "neutral")).toBe("surprised");
		expect(expressionFor("talking", "angry")).toBe("talking");
	});
});
