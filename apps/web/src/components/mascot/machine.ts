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

export const TRANSITIONS: Record<MascotState, Edges> = {
	idle: { ...ACTIONS, BLINK: "blink", LOOK: "look" },
	blink: { ...ACTIONS, LOOK: "look", TIMEOUT: "idle" },
	look: { ...ACTIONS, BLINK: "blink", LOOK_AWAY: "idle" },
	hop: { TIMEOUT: "idle" },
	poked: { POKE: "poked", HOP: "hop", TIMEOUT: "idle" },
	happy: { ...ACTIONS, TIMEOUT: "idle" },
	sleepy: { WAKE: "idle", POKE: "surprised", SURPRISE: "surprised" },
	talking: {
		STOP_TALK: "idle",
		POKE: "poked",
		HOP: "hop",
		ANGER: "angry",
		SURPRISE: "surprised",
		CHEER: "happy",
		SLEEP: "sleepy",
	},
	angry: {
		POKE: "angry",
		CHEER: "happy",
		SURPRISE: "surprised",
		HOP: "hop",
		TIMEOUT: "idle",
	},
	surprised: { POKE: "poked", HOP: "hop", CHEER: "happy", TIMEOUT: "idle" },
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

export function expressionFor(
	state: MascotState,
	resting: Expression,
): Expression {
	switch (state) {
		case "happy":
			return "happy";
		case "sleepy":
			return "sleepy";
		case "talking":
			return "talking";
		case "angry":
			return "angry";
		case "surprised":
		case "poked":
			return "surprised";
		default:
			return resting;
	}
}
