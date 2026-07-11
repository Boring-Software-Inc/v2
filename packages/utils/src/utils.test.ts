import { describe, expect, test } from "bun:test";
import { getErrorMessage, toError } from "./errors.ts";
import { generateId } from "./id.ts";
import { backoffWithJitter } from "./retry.ts";
import { truncate } from "./string.ts";

describe("generateId", () => {
	test("returns valid UUIDv7", () => {
		const id = generateId();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	test("is time-sortable (monotonic across a delay)", async () => {
		const a = generateId();
		await new Promise((r) => setTimeout(r, 2));
		const b = generateId();
		expect(a < b).toBe(true);
	});
});

describe("errors", () => {
	test("toError passes Error through and wraps others", () => {
		const e = new Error("boom");
		expect(toError(e)).toBe(e);
		expect(toError("x").message).toBe("x");
		expect(toError({ a: 1 }).message).toBe('{"a":1}');
	});

	test("getErrorMessage", () => {
		expect(getErrorMessage(new Error("nope"))).toBe("nope");
	});
});

describe("truncate", () => {
	test("cuts with ellipsis and leaves short strings alone", () => {
		expect(truncate("hello", 10)).toBe("hello");
		expect(truncate("hello world", 6)).toBe("hello…");
		expect(truncate("hello world", 6).length).toBeLessThanOrEqual(6);
	});
});

describe("backoffWithJitter", () => {
	test("stays within [0, min(cap, base*2^n)]", () => {
		for (let attempt = 0; attempt < 10; attempt++) {
			const d = backoffWithJitter(attempt, { baseMs: 100, capMs: 1000 });
			expect(d).toBeGreaterThanOrEqual(0);
			expect(d).toBeLessThanOrEqual(Math.min(1000, 100 * 2 ** attempt));
		}
	});
});
