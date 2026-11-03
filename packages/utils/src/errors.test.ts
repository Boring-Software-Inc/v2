import { describe, expect, test } from "bun:test";
import { getErrorMessage, toError } from "@tripwire/utils";

describe("toError", () => {
	test("retains Error identity and primitive-string messages", () => {
		const cause = new TypeError("failure");
		expect(toError(cause)).toBe(cause);
		expect(getErrorMessage(cause)).toBe("failure");
		for (const message of ["", "message", 'quoted"\ntext']) {
			expect(toError(message).message).toBe(message);
			expect(getErrorMessage(message)).toBe(message);
		}
	});

	test("preserves JSON messages and omitted top-level values", () => {
		for (const cause of [
			null,
			true,
			42,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			undefined,
			Symbol("cause"),
			() => 1,
			{ kept: 1, omitted: undefined },
			[1, undefined],
			new Date("2026-10-01T00:00:00.000Z"),
		]) {
			expect(toError(cause).message).toBe(
				new Error(JSON.stringify(cause)).message,
			);
		}
	});

	test("uses toJSON once and falls back to String on serialization failure", () => {
		let calls = 0;
		expect(
			toError({
				toJSON() {
					calls += 1;
					return { calls };
				},
			}).message,
		).toBe('{"calls":1}');
		expect(calls).toBe(1);
		const cycle = {};
		Object.defineProperty(cycle, "self", { value: cycle, enumerable: true });
		for (const cause of [
			cycle,
			1n,
			{
				get field() {
					throw new Error("getter");
				},
			},
			{
				toJSON() {
					throw new Error("toJSON");
				},
				toString() {
					return "fallback";
				},
			},
		]) {
			expect(toError(cause).message).toBe(String(cause));
		}
	});

	test("preserves failures from the String fallback", () => {
		const cause = new Error("cannot format");
		let caught: unknown;
		try {
			toError({
				toJSON() {
					throw new Error("cannot serialize");
				},
				toString() {
					throw cause;
				},
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBe(cause);
	});
});
