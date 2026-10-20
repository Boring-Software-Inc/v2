import type { Ambient, Gaze } from "#/components/mascot/engine";
import type { Expression } from "#/components/mascot/geometry";
import type { PoseName } from "#/components/mascot/poses";

export type MascotMood = {
	face: Expression;
	sleeps?: boolean;
	restPose?: PoseName;
	wander?: boolean;
	gazeRest?: Gaze;
	far?: number;
	ambient?: readonly Ambient[];
};

const OCCASIONAL_HOP: readonly Ambient[] = [{ event: "HOP", every: [9, 18] }];
const NOW_AND_THEN_TALK: readonly Ambient[] = [
	{
		event: "TALK",
		every: [6, 12],
		release: { event: "STOP_TALK", after: 2.4 },
	},
];

export const MASCOT_MOODS = {
	"moderation-queue-empty": { face: "sleepy", sleeps: true },
	"activity-empty": { face: "neutral", wander: true },
	"activity-no-matches": { face: "surprised", wander: true },
	"activity-error": { face: "angry", restPose: "stiff" },
	"analytics-events-empty": { face: "neutral", wander: true },
	"rules-custom-empty": { face: "neutral", ambient: OCCASIONAL_HOP },
	"rules-empty": { face: "neutral", ambient: OCCASIONAL_HOP },
	"rules-workflows-empty": { face: "neutral", wander: true },
	"rules-active-empty": { face: "sleepy", sleeps: true },
	"workflows-empty": { face: "happy", ambient: OCCASIONAL_HOP },
	"chart-at-rest": { face: "neutral", gazeRest: { x: -0.9, y: 0.5 }, far: 240 },
	"invites-empty": { face: "happy" },
	"forges-empty": { face: "neutral" },
	"repos-empty": { face: "neutral", wander: true },
	"repos-syncing": { face: "neutral", wander: true },
	"billing-empty": { face: "neutral" },
	"admin-table-empty": { face: "neutral" },
	"install-nothing": { face: "surprised", wander: true },
	"not-found": { face: "surprised", ambient: NOW_AND_THEN_TALK },
	"run-not-found": { face: "surprised", ambient: NOW_AND_THEN_TALK },
	"workflow-not-found": { face: "surprised", ambient: NOW_AND_THEN_TALK },
} as const satisfies Record<string, MascotMood>;

export type MascotMoodKey = keyof typeof MASCOT_MOODS;
