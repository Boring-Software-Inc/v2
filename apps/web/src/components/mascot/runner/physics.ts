export const STEP = 1 / 120;
export const GRAVITY = 2400;
export const JUMP_SPEED = 640;
export const ANTICIPATION = 0.045;
export const START_SPEED = 230;
export const MAX_SPEED = 540;
export const ACCELERATION = 7;

export const NONE = 0;
export const LANDED = 1;
export const LAUNCHED = 2;

export type Body = {
	height: number;
	velocity: number;
	grounded: boolean;
	windup: number;
};

export function groundedBody(): Body {
	return { height: 0, velocity: 0, grounded: true, windup: 0 };
}

export function resetBody(body: Body) {
	body.height = 0;
	body.velocity = 0;
	body.grounded = true;
	body.windup = 0;
}

export function stepBody(body: Body, jump: boolean, dt = STEP): number {
	if (body.grounded) {
		if (body.windup > 0) {
			body.windup -= dt;
			if (body.windup > 0) {
				return NONE;
			}
			body.windup = 0;
			body.grounded = false;
			body.velocity = JUMP_SPEED;
			return LAUNCHED;
		}
		if (jump) {
			body.windup = ANTICIPATION;
		}
		return NONE;
	}
	body.velocity -= GRAVITY * dt;
	body.height += body.velocity * dt;
	if (body.height <= 0) {
		resetBody(body);
		return LANDED;
	}
	return NONE;
}

export function airtime(): number {
	return (2 * JUMP_SPEED) / GRAVITY;
}

export function apexHeight(): number {
	return (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
}

export function speedAt(seconds: number): number {
	return Math.min(MAX_SPEED, START_SPEED + ACCELERATION * seconds);
}

export function fixedSteps(carry: number, dt: number, out: number[]): number {
	const total = carry + Math.min(dt, 0.1);
	const steps = Math.floor(total / STEP + 1e-9);
	out[0] = total - steps * STEP;
	return steps;
}

export type Bone = { active: boolean; x: number; height: number };

export const BONE_WIDTH = 32.5;
export const BONE_HEIGHTS = [15, 32.5] as const;
export const CLUSTER_GAP = 4;
export const PLAYER_SIZE = 44;

export function bonePool(size: number): Bone[] {
	return Array.from({ length: size }, () => ({
		active: false,
		x: 0,
		height: 0,
	}));
}

export function minGap(speed: number): number {
	return speed * airtime() * 1.15 + 40;
}

export function nextGap(speed: number, random: () => number): number {
	const min = minGap(speed);
	return min + random() * min * 0.9;
}

function pickHeight(random: () => number): number {
	return BONE_HEIGHTS[Math.floor(random() * BONE_HEIGHTS.length)] ?? 15;
}

function claim(pool: Bone[], x: number, height: number): boolean {
	for (const bone of pool) {
		if (!bone.active) {
			bone.active = true;
			bone.x = x;
			bone.height = height;
			return true;
		}
	}
	return false;
}

export function spawnBones(
	pool: Bone[],
	x: number,
	random: () => number,
): number {
	const first = pickHeight(random);
	if (!claim(pool, x, first)) {
		return 0;
	}
	if (random() < 0.22) {
		const second = Math.min(first, pickHeight(random));
		return claim(pool, x + BONE_WIDTH + CLUSTER_GAP, second) ? 2 : 1;
	}
	return 1;
}

const BONE_INSET = BONE_WIDTH * 0.2;
const PLAYER_INSET = PLAYER_SIZE * 0.24;

export function hits(
	pool: readonly Bone[],
	playerX: number,
	lift: number,
): boolean {
	const left = playerX + PLAYER_INSET;
	const right = playerX + PLAYER_SIZE - PLAYER_INSET;
	const bottom = lift + PLAYER_SIZE * 0.08;
	for (const bone of pool) {
		if (!bone.active) {
			continue;
		}
		if (
			left < bone.x + BONE_WIDTH - BONE_INSET &&
			right > bone.x + BONE_INSET &&
			bottom < bone.height * 0.86
		) {
			return true;
		}
	}
	return false;
}
