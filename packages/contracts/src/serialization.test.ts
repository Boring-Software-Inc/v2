import { describe, expect, test } from "bun:test";
import {
	jsonSerializationSchema,
	thrownStringSchema,
} from "./serialization.ts";

describe("jsonSerializationSchema", () => {
	test("matches native serialization of primitives and omissions", () => {
		for (const value of [
			null,
			true,
			false,
			0,
			-1,
			'quoted"\ntext',
			Number.NaN,
			Number.POSITIVE_INFINITY,
			undefined,
			Symbol("omitted"),
			() => 1,
			{ kept: 1, omitted: undefined, method: () => 2 },
			[undefined, Symbol("omitted"), () => 3, Number.NaN],
		]) {
			expect(jsonSerializationSchema.parse(value)).toBe(JSON.stringify(value));
		}
	});

	test("preserves Date and invokes toJSON once", () => {
		const date = new Date("2026-10-01T02:03:04.000Z");
		expect(jsonSerializationSchema.parse(date)).toBe(
			'"2026-10-01T02:03:04.000Z"',
		);
		let calls = 0;
		const value = {
			toJSON() {
				calls += 1;
				return { calls, omitted: undefined };
			},
		};
		expect(jsonSerializationSchema.parse(value)).toBe('{"calls":1}');
		expect(calls).toBe(1);
	});

	test("retains native cycle and BigInt failures", () => {
		const cycle = {};
		Object.defineProperty(cycle, "self", { value: cycle, enumerable: true });
		expect(() => jsonSerializationSchema.parse(cycle)).toThrow(TypeError);
		expect(() => jsonSerializationSchema.parse(1n)).toThrow(TypeError);
	});

	test("propagates thrown getter and toJSON causes by identity", () => {
		const cause = new Error("serialization failed");
		for (const value of [
			{
				get field() {
					throw cause;
				},
			},
			{
				toJSON() {
					throw cause;
				},
			},
		]) {
			let caught: unknown;
			try {
				jsonSerializationSchema.parse(value);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBe(cause);
		}
	});
});

describe("thrownStringSchema", () => {
	test("accepts only primitive strings without coercion", () => {
		expect(thrownStringSchema.parse("message")).toBe("message");
		for (const cause of [undefined, null, 1, false, new Error("message")]) {
			expect(thrownStringSchema.safeParse(cause).success).toBe(false);
		}
	});
});
