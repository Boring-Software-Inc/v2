import { describe, expect, test } from "bun:test";
import {
	ANTICIPATION,
	airtime,
	apexHeight,
	BONE_WIDTH,
	bonePool,
	fixedSteps,
	groundedBody,
	hits,
	LANDED,
	LAUNCHED,
	MAX_SPEED,
	minGap,
	nextGap,
	PLAYER_SIZE,
	START_SPEED,
	STEP,
	spawnBones,
	speedAt,
	stepBody,
} from "#/components/mascot/runner/physics";

function jumpTrace(steps: number) {
	const body = groundedBody();
	const trace: { height: number; grounded: boolean; event: number }[] = [];
	for (let i = 0; i < steps; i++) {
		const event = stepBody(body, i === 0);
		trace.push({ height: body.height, grounded: body.grounded, event });
	}
	return trace;
}

function sequence(values: number[]) {
	let i = 0;
	return () => {
		const v = values[i % values.length] ?? 0;
		i++;
		return v;
	};
}

describe("runner physics", () => {
	test("a press winds up, then launches", () => {
		const trace = jumpTrace(20);
		const launch = trace.findIndex((t) => t.event === LAUNCHED);
		expect(launch).toBe(Math.ceil(ANTICIPATION / STEP));
		expect(trace[launch - 1]?.grounded).toBe(true);
		expect(trace[launch]?.grounded).toBe(false);
	});

	test("a jump peaks at the apex and lands once after its airtime", () => {
		const trace = jumpTrace(200);
		const peak = Math.max(...trace.map((t) => t.height));
		expect(peak).toBeGreaterThan(apexHeight() * 0.95);
		expect(peak).toBeLessThan(apexHeight() * 1.03);
		const launch = trace.findIndex((t) => t.event === LAUNCHED);
		const land = trace.findIndex((t) => t.event === LANDED);
		expect((land - launch) * STEP).toBeCloseTo(airtime(), 1);
		expect(trace.filter((t) => t.event === LANDED)).toHaveLength(1);
		expect(trace[land]).toEqual({ height: 0, grounded: true, event: LANDED });
	});

	test("an idle body stays on the ground", () => {
		const body = groundedBody();
		expect(stepBody(body, false)).toBe(0);
		expect(body).toEqual(groundedBody());
	});

	test("60, 120 and 144 Hz frames run the same number of steps", () => {
		const count = (hz: number) => {
			const carry = [0];
			let steps = 0;
			for (let i = 0; i < hz; i++) {
				steps += fixedSteps(carry[0] ?? 0, 1 / hz, carry);
			}
			return steps;
		};
		expect(count(60)).toBe(120);
		expect(count(120)).toBe(120);
		expect(count(144)).toBe(120);
	});

	test("speed ramps up and caps", () => {
		expect(speedAt(0)).toBe(START_SPEED);
		expect(speedAt(10)).toBeGreaterThan(START_SPEED);
		expect(speedAt(10_000)).toBe(MAX_SPEED);
	});
});

describe("bone spawner", () => {
	test("gaps never drop below the fair minimum", () => {
		for (const speed of [START_SPEED, 400, MAX_SPEED]) {
			for (const r of [0, 0.3, 0.99]) {
				expect(nextGap(speed, () => r)).toBeGreaterThanOrEqual(minGap(speed));
			}
		}
	});

	test("the minimum gap leaves room to land between bones", () => {
		for (const speed of [START_SPEED, MAX_SPEED]) {
			expect(minGap(speed)).toBeGreaterThan(speed * airtime());
		}
	});

	test("bones come alone or as a close pair, reusing the pool", () => {
		const pool = bonePool(3);
		expect(spawnBones(pool, 100, sequence([0.5, 0.9]))).toBe(1);
		expect(spawnBones(pool, 300, sequence([0.1, 0.1, 0.9]))).toBe(2);
		expect((pool[2]?.x ?? 0) - (pool[1]?.x ?? 0)).toBeLessThan(BONE_WIDTH * 2);
		expect(spawnBones(pool, 500, sequence([0.5, 0.9]))).toBe(0);
		if (pool[0]) {
			pool[0].active = false;
		}
		expect(spawnBones(pool, 500, sequence([0.5, 0.9]))).toBe(1);
	});
});

describe("collision", () => {
	const pool = bonePool(1);
	if (pool[0]) {
		pool[0].active = true;
		pool[0].x = 100;
		pool[0].height = 30;
	}

	test("a player on the ground hits a bone it overlaps", () => {
		expect(hits(pool, 95, 0)).toBe(true);
	});

	test("a player above the bone clears it", () => {
		expect(hits(pool, 95, 40)).toBe(false);
	});

	test("the hitbox forgives a graze at the edges", () => {
		expect(hits(pool, 100 - PLAYER_SIZE + 12, 0)).toBe(false);
		expect(hits(pool, 100 + BONE_WIDTH - 12, 0)).toBe(false);
	});

	test("inactive bones never hit", () => {
		expect(hits(bonePool(2), 95, 0)).toBe(false);
	});
});
