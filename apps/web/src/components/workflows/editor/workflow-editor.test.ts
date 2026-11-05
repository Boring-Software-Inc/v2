import { expect, test } from "bun:test";
import { dragEndScreenPosition } from "#/components/workflows/editor/workflow-editor";

/** Bun has Event but no browser MouseEvent; retain its prototype relationship. */
class TestMouseEvent extends Event {
	constructor(
		type: string,
		readonly clientX: number,
		readonly clientY: number,
	) {
		super(type);
	}
}

class TestPointerEvent extends TestMouseEvent {}

function withMouseEvents(run: () => void) {
	const original = Object.getOwnPropertyDescriptor(globalThis, "MouseEvent");
	Object.defineProperty(globalThis, "MouseEvent", {
		configurable: true,
		value: TestMouseEvent,
	});
	try {
		run();
	} finally {
		if (original) {
			Object.defineProperty(globalThis, "MouseEvent", original);
		} else {
			Reflect.deleteProperty(globalThis, "MouseEvent");
		}
	}
}

test("drag end places pointer and mouse activators at start plus delta, including zero coordinates", () => {
	withMouseEvents(() => {
		expect(
			dragEndScreenPosition({
				activatorEvent: new TestPointerEvent("pointerdown", 0, 120),
				delta: { x: 25, y: -30 },
			}),
		).toEqual({ x: 25, y: 90 });
		expect(
			dragEndScreenPosition({
				activatorEvent: new TestMouseEvent("mousedown", 50, 0),
				delta: { x: -5, y: 20 },
			}),
		).toEqual({ x: 45, y: 20 });
	});
});

test("non-pointer drag termination has no placement", () => {
	withMouseEvents(() => {
		expect(
			dragEndScreenPosition({
				activatorEvent: new Event("keydown"),
				delta: { x: 25, y: 30 },
			}),
		).toBeNull();
		expect(
			dragEndScreenPosition({
				activatorEvent: new Event("touchstart"),
				delta: { x: 25, y: 30 },
			}),
		).toBeNull();
	});
});
