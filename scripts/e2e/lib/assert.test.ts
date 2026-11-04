import { describe, expect, test } from "bun:test";
import { Asserter } from "./assert.ts";

describe("Asserter", () => {
	test("preserves string display and native JSON equality", () => {
		const a = new Asserter();
		expect(a.equals("string", "plain", "plain")).toBe(true);
		expect(a.results[0]).toEqual({
			label: "string",
			expected: "plain",
			actual: "plain",
			ok: true,
		});
		for (const value of [
			null,
			undefined,
			false,
			0,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Symbol("not serialized"),
			() => 1,
			[undefined, Number.NaN],
			{ nested: [1, "two"], omitted: undefined },
			new Date("2026-07-17T00:00:00.000Z"),
		]) {
			expect(a.equals("native", value, value)).toBe(true);
			expect(a.results.at(-1)?.expected).toBe(JSON.stringify(value));
		}
		expect(a.equals("native collision", null, Number.NaN)).toBe(true);
		expect(a.equals("display collision", "1", 1)).toBe(true);
		expect(a.equals("mismatch", { a: 1 }, { a: 2 })).toBe(false);
		expect(a.passed).toBe(false);
		expect(a.failures.map((r) => r.label)).toEqual(["mismatch"]);
	});

	test("does not weaken boolean or containment gates", () => {
		const a = new Asserter();
		expect(a.ok("blocked", false, "blocked detail")).toBe(false);
		expect(a.includes("missing", "actual", "expected")).toBe(false);
		expect(a.ok("ready", true)).toBe(true);
		expect(a.includes("present", "actual", "act")).toBe(true);
		expect(a.failures).toEqual([
			{
				label: "blocked",
				expected: "true",
				actual: "blocked detail",
				ok: false,
			},
			{
				label: "missing",
				expected: 'contains "expected"',
				actual: "absent",
				ok: false,
			},
		]);
	});

	test("preserves serialization counts, getters, and toJSON", () => {
		let calls = 0;
		let reads = 0;
		const value = {
			get observed() {
				reads += 1;
				return "read";
			},
			toJSON() {
				calls += 1;
				return { observed: this.observed };
			},
		};
		const a = new Asserter();
		expect(a.equals("same", value, value)).toBe(true);
		expect(calls).toBe(4);
		expect(reads).toBe(4);
		expect(a.results[0]?.actual).toBe('{"observed":"read"}');
	});

	test("propagates native failures without recording a passing result", () => {
		const a = new Asserter();
		const cycle: object[] = [];
		cycle.push(cycle);
		expect(() => a.equals("bigint", 1n, 1n)).toThrow(TypeError);
		expect(() => a.equals("cycle", cycle, cycle)).toThrow(TypeError);
		const sentinel = new Error("getter sentinel");
		const value = {
			get field() {
				throw sentinel;
			},
		};
		try {
			a.equals("getter", value, null);
			throw new Error("expected native getter exception");
		} catch (cause) {
			expect(cause).toBe(sentinel);
		}
		expect(a.results).toEqual([]);
	});

	test("does not coerce rejected objects while choosing string display", () => {
		const a = new Asserter();
		const sentinel = new Error("coercion forbidden");
		const value = {
			[Symbol.toPrimitive]() {
				throw sentinel;
			},
			toString() {
				throw sentinel;
			},
			toJSON() {
				return "native projection";
			},
		};
		expect(a.equals("native projection", value, '"native projection"')).toBe(
			true,
		);
		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		expect(() => a.equals("revoked", revoked.proxy, null)).toThrow(TypeError);
		expect(a.results).toHaveLength(1);
	});
});
