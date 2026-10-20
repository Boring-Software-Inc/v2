import type { Warp } from "#/components/mascot/geometry";

export type Pose = Warp & { cheek: number };

export const REST_POSE: Pose = {
	sx: 1,
	sy: 1,
	lean: 0,
	bow: 0,
	bowT: 0,
	keystone: 0,
	lift: 0,
	rot: 0,
	droop: 0,
	cheek: 0,
};

const pose = (p: Partial<Pose>): Pose => ({ ...REST_POSE, ...p });

export const V7_POSES = {
	rest: pose({}),
	anticipation: pose({ sx: 1.08, sy: 0.9, bow: 2.5, bowT: -1.5 }),
	stretch: pose({ sx: 0.86, sy: 1.15, lean: 7, bow: -1.5, lift: 12 }),
	apex: pose({ sx: 0.98, sy: 1.03, lean: -2, lift: 20, bowT: 1.5 }),
	landing: pose({
		sx: 1.18,
		sy: 0.82,
		bow: 5,
		bowT: 6,
		keystone: 0.07,
		lean: 3,
		rot: 4,
		cheek: 1,
	}),
	settle: pose({ sx: 0.96, sy: 1.05, lean: -3, bow: -1 }),
	bounce: pose({
		sx: 1.08,
		sy: 0.92,
		bow: 2.5,
		bowT: 3,
		lift: 6,
		rot: -2,
		cheek: 1,
	}),
	slump: pose({ sx: 1.06, sy: 0.9, lean: -9, bow: 3, droop: 5, rot: -3 }),
	tall: pose({ sx: 0.88, sy: 1.13, bow: -1.5, bowT: 2, lift: 4 }),
	poke: pose({ sx: 1.12, sy: 0.88, bow: 3.5, bowT: 3, cheek: 1 }),
	stiff: pose({ sx: 0.95, sy: 1.05, bow: -1, bowT: 1, lift: 2 }),
	chatter: pose({ sx: 1.03, sy: 0.97, bowT: 1.5, lift: 2 }),
	puddle: pose({ sx: 1.16, sy: 0.78, bow: 4, bowT: 3, keystone: 0.08 }),
} satisfies Record<string, Pose>;

export type PoseName = keyof typeof V7_POSES;

export const DEFAULT_INTENSITY = 0.6;

export function soften(p: Pose, intensity: number, lift = true): Pose {
	return {
		sx: 1 + (p.sx - 1) * intensity,
		sy: 1 + (p.sy - 1) * intensity,
		lean: p.lean * intensity,
		bow: p.bow * intensity,
		bowT: p.bowT * intensity,
		keystone: p.keystone * intensity,
		rot: p.rot * intensity,
		droop: p.droop * intensity,
		cheek: p.cheek * intensity,
		lift: lift ? p.lift : 0,
	};
}
