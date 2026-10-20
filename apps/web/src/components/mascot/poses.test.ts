import { describe, expect, test } from "bun:test";
import {
	REST_WARP,
	restOutline,
	warpPoint,
} from "#/components/mascot/geometry";
import {
	type Pose,
	REST_POSE,
	soften,
	V7_POSES,
} from "#/components/mascot/poses";

const plain = (p: Pose) =>
	Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v + 0]));

describe("mascot poses", () => {
	test("full intensity is v7", () => {
		expect(soften(V7_POSES.landing, 1)).toEqual(V7_POSES.landing);
	});

	test("zero intensity keeps only the lift", () => {
		expect(plain(soften(V7_POSES.stretch, 0))).toEqual({
			...REST_POSE,
			lift: 12,
		});
		expect(plain(soften(V7_POSES.stretch, 0, false))).toEqual(REST_POSE);
	});

	test("default softening scales every warp amount to 60%", () => {
		const p = soften(V7_POSES.landing, 0.6);
		expect(p.sx).toBeCloseTo(1.108);
		expect(p.sy).toBeCloseTo(0.892);
		expect(p.bow).toBeCloseTo(3);
		expect(p.rot).toBeCloseTo(2.4);
		expect(p.cheek).toBeCloseTo(0.6);
	});

	test("rest warp leaves the pixel outline exact", () => {
		for (const [x, y] of restOutline()) {
			const [nx, ny] = warpPoint(REST_WARP, x, y);
			expect(nx).toBeCloseTo(x, 9);
			expect(ny).toBeCloseTo(y, 9);
		}
	});
});
