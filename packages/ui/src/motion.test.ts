import { describe, expect, test } from "bun:test";
import { UI_MOTION } from "./motion";

describe("UI_MOTION", () => {
	test("keeps the finite product motion vocabulary crisp", () => {
		expect(Object.keys(UI_MOTION)).toEqual([
			"state",
			"position",
			"slide",
			"column",
			"columnExit",
			"track",
		]);
		expect(UI_MOTION.state).toEqual({
			duration: 0.16,
			ease: [0.2, 0.8, 0.2, 1],
		});
		expect(UI_MOTION.position).toEqual({
			duration: 0.18,
			ease: [0.645, 0.045, 0.355, 1],
		});
		expect(UI_MOTION.slide.duration).toBeLessThanOrEqual(0.2);
	});

	test("keeps guided-flow motion short enough to stay out of the way", () => {
		expect(UI_MOTION.column.duration).toBeLessThanOrEqual(0.4);
		expect(UI_MOTION.columnExit.duration).toBeLessThan(
			UI_MOTION.column.duration,
		);
		expect(UI_MOTION.track.duration).toBeLessThanOrEqual(0.7);
	});
});
