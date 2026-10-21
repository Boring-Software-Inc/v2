import { describe, expect, test } from "bun:test";
import {
	BODY_W,
	CELL,
	EXPRESSIONS,
	eyeShapes,
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

describe("pixel eyes", () => {
	test("every eye sits on the 16-cell grid at rest", () => {
		for (const expr of EXPRESSIONS) {
			for (const eye of eyeShapes(expr)) {
				for (const [x, y] of eye.outline) {
					expect(x % CELL).toBe(0);
					expect(y % CELL).toBe(0);
				}
			}
		}
	});

	test("the eyes balance around the body centre", () => {
		for (const expr of EXPRESSIONS) {
			const eyes = eyeShapes(expr);
			const mean = eyes.reduce((sum, e) => sum + e.cx, 0) / eyes.length;
			expect(mean).toBe(BODY_W / 2);
		}
	});
});
