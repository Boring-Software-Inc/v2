import type { Expression } from "#/components/mascot/geometry";

export const MASCOT_STATES = [
	"idle",
	"blink",
	"look",
	"hop",
	"poked",
	"happy",
	"sleepy",
	"talking",
	"angry",
	"surprised",
	"sploot",
	"annoyed",
	"furious",
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

export const MASCOT_EVENTS = [
	"HOP",
	"POKE",
	"BLINK",
	"LOOK",
	"LOOK_AWAY",
	"SLEEP",
	"WAKE",
	"TALK",
	"STOP_TALK",
	"ANGER",
	"SURPRISE",
	"CHEER",
	"SPLOOT",
	"ANNOY",
	"TANTRUM",
	"TIMEOUT",
] as const;

export type MascotEvent = (typeof MASCOT_EVENTS)[number];

type Edges = Partial<Record<MascotEvent, MascotState>>;

const ACTIONS: Edges = {
	HOP: "hop",
	POKE: "poked",
	SLEEP: "sleepy",
	TALK: "talking",
	ANGER: "angry",
	SURPRISE: "surprised",
	CHEER: "happy",
	SPLOOT: "sploot",
};

const ESCALATE: Edges = { ANNOY: "annoyed", TANTRUM: "furious" };

export const TRANSITIONS: Record<MascotState, Edges> = {
	idle: { ...ACTIONS, ...ESCALATE, BLINK: "blink", LOOK: "look" },
	blink: { ...ACTIONS, ...ESCALATE, LOOK: "look", TIMEOUT: "idle" },
	look: { ...ACTIONS, ...ESCALATE, BLINK: "blink", LOOK_AWAY: "idle" },
	hop: { TIMEOUT: "idle" },
	poked: { ...ESCALATE, POKE: "poked", HOP: "hop", TIMEOUT: "idle" },
	annoyed: { ...ESCALATE, POKE: "poked", HOP: "hop", TIMEOUT: "idle" },
	furious: { TIMEOUT: "idle" },
	happy: { ...ACTIONS, ...ESCALATE, TIMEOUT: "idle" },
	sleepy: {
		...ESCALATE,
		WAKE: "idle",
		POKE: "surprised",
		SURPRISE: "surprised",
	},
	talking: {
		...ESCALATE,
		STOP_TALK: "idle",
		POKE: "poked",
		HOP: "hop",
		ANGER: "angry",
		SURPRISE: "surprised",
		CHEER: "happy",
		SLEEP: "sleepy",
	},
	angry: {
		...ESCALATE,
		POKE: "angry",
		CHEER: "happy",
		SURPRISE: "surprised",
		HOP: "hop",
		TIMEOUT: "idle",
	},
	surprised: {
		...ESCALATE,
		POKE: "poked",
		HOP: "hop",
		CHEER: "happy",
		TIMEOUT: "idle",
	},
	sploot: { TIMEOUT: "idle" },
};

export function transition(
	state: MascotState,
	event: MascotEvent,
): MascotState | null {
	return TRANSITIONS[state][event] ?? null;
}

export function allowedEvents(state: MascotState): MascotEvent[] {
	return MASCOT_EVENTS.filter((event) => TRANSITIONS[state][event]);
}

export const GAZE_STATES: ReadonlySet<MascotState> = new Set([
	"idle",
	"blink",
	"look",
	"talking",
	"happy",
]);

export const RESTING_STATES: ReadonlySet<MascotState> = new Set([
	"idle",
	"blink",
	"look",
]);

export const POKE_WINDOW_MS = 3000;
export const ANNOYED_AT = 3;
export const ANGRY_EYES_AT = 4;
export const MAD_AT = 5;

export function recentPokes(times: readonly number[], now: number): number[] {
	return times.filter((t) => now - t <= POKE_WINDOW_MS);
}

export function pokeEvent(count: number): MascotEvent {
	if (count >= MAD_AT) {
		return "TANTRUM";
	}
	if (count >= ANNOYED_AT) {
		return "ANNOY";
	}
	return "POKE";
}

export function resolvePoke(
	state: MascotState,
	count: number,
): MascotEvent | null {
	const escalated = pokeEvent(count);
	if (transition(state, escalated)) {
		return escalated;
	}
	return transition(state, "POKE") ? "POKE" : null;
}

export function expressionFor(
	state: MascotState,
	resting: Expression,
	pokes = 0,
): Expression {
	switch (state) {
		case "annoyed":
			return pokes >= ANGRY_EYES_AT ? "angry" : "annoyed";
		case "furious":
			return "angry";
		case "happy":
			return "happy";
		case "sleepy":
			return "sleepy";
		case "talking":
			return "talking";
		case "angry":
			return "angry";
		case "surprised":
			return "surprised";
		case "poked":
			return "poked";
		default:
			return resting;
	}
}
