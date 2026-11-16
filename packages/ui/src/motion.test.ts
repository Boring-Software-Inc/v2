import { describe, expect, test } from "bun:test";
import { UI_MOTION } from "./motion";

describe("UI_MOTION", () => {
	test("keeps the finite product motion vocabulary crisp", () => {
		expect(Object.keys(UI_MOTION)).toEqual(["state", "position", "slide"]);
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
});
