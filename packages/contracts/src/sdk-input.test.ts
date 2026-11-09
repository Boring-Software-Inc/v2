import { describe, expect, test } from "bun:test";
import {
	sdkBooleanValueSchema,
	sdkInnerComparisonSchema,
	sdkListArgumentSchema,
	sdkNumberArgumentSchema,
	sdkNumberValueSchema,
	sdkProducedTypeSchema,
	sdkRegexArgumentSchema,
	sdkScanMatchesSchema,
	sdkScanPatternsSchema,
	sdkStringListSchema,
	sdkTextMapSchema,
	sdkTextValueSchema,
} from "./sdk-input.ts";

describe("SDK live input schemas", () => {
	test("numbers distinguish produced NaN from comparison NaN without rejecting infinities", () => {
		for (const value of [0, -0, 1, Infinity, -Infinity]) {
			expect(sdkNumberArgumentSchema.parse(value)).toBe(value);
			expect(sdkNumberValueSchema.parse(value)).toBe(value);
		}
		expect(sdkNumberArgumentSchema.parse(NaN)).toBeNaN();
		expect(sdkNumberValueSchema.safeParse(NaN).success).toBe(false);
		for (const value of ["1", null, undefined, 1n, new Number(1)]) {
			expect(sdkNumberArgumentSchema.safeParse(value).success).toBe(false);
		}
	});

	test("rejected numeric inputs and diagnostic labels do not inspect object metadata", () => {
		const reads: string[] = [];
		const values = [
			Object.create({
				get constructor() {
					reads.push("constructor");
					throw new Error("constructor read");
				},
			}),
			new Proxy(
				{},
				{
					getPrototypeOf() {
						reads.push("getPrototypeOf");
						throw new Error("prototype read");
					},
				},
			),
		];
		for (const value of values) {
			for (const schema of [sdkNumberArgumentSchema, sdkNumberValueSchema]) {
				const parsed = schema.safeParse(value);
				expect(parsed.success).toBe(false);
				if (!parsed.success) {
					expect(parsed.error.issues[0]?.code).toBe("invalid_union");
				}
			}
			expect(sdkProducedTypeSchema.parse(value)).toBe("object");
		}
		expect(reads).toEqual([]);
	});

	test("required field getters still throw without being masked by parser errors", () => {
		const value = {
			get kind() {
				throw new Error("kind read");
			},
		};
		expect(() => sdkInnerComparisonSchema.safeParse(value)).toThrow(
			"kind read",
		);
		expect(() => sdkScanMatchesSchema.safeParse([value])).toThrow("kind read");
		expect(() => sdkScanPatternsSchema.safeParse([value])).toThrow("kind read");
	});

	test("primitive and regex gates never coerce", () => {
		expect(sdkTextValueSchema.parse("")).toBe("");
		expect(sdkTextValueSchema.safeParse(new String("text")).success).toBe(
			false,
		);
		expect(sdkBooleanValueSchema.parse(false)).toBe(false);
		expect(sdkBooleanValueSchema.safeParse(0).success).toBe(false);
		const pattern = /x/g;
		expect(sdkRegexArgumentSchema.parse(pattern)).toBe(pattern);
		expect(sdkRegexArgumentSchema.safeParse("/x/g").success).toBe(false);
	});

	test("lists retain identity, holes, mixed members, and inherited indexed entries", () => {
		const sparse = new Array<string>(2);
		expect(sdkStringListSchema.parse(sparse)).toBe(sparse);
		expect(0 in sparse).toBe(false);
		const mixed = [undefined, 1, "x", {}];
		expect(sdkListArgumentSchema.parse(mixed)).toBe(mixed);
		expect(sdkStringListSchema.safeParse(mixed).success).toBe(false);
		const inherited = new Array<string>(1);
		Object.setPrototypeOf(
			inherited,
			Object.assign(Object.create(Array.prototype), { 0: 7 }),
		);
		expect(sdkStringListSchema.safeParse(inherited).success).toBe(false);
		expect(sdkListArgumentSchema.safeParse({ length: 0 }).success).toBe(false);
	});

	test("text maps check only own enumerable values and preserve object identity", () => {
		const map = Object.assign(Object.create({ inherited: 7 }), {
			comment: "x",
		});
		expect(sdkTextMapSchema.parse(map)).toBe(map);
		for (const value of [null, [], () => "x", { comment: 7 }]) {
			expect(sdkTextMapSchema.safeParse(value).success).toBe(false);
		}
		expect(sdkTextMapSchema.safeParse(new Date(0)).success).toBe(true);
	});

	test("scan lists accept live regexes, inherited fields, array records, and holes", () => {
		const pattern = { kind: "word", pattern: /x/g };
		const patterns = [Object.create(pattern), Object.assign([], pattern)];
		expect(sdkScanPatternsSchema.parse(patterns)).toBe(patterns);
		const match = { kind: "word", value: "x", location: "comment" };
		const matches = [Object.create(match), Object.assign([], match)];
		expect(sdkScanMatchesSchema.parse(matches)).toBe(matches);
		const holes = new Array(2);
		expect(sdkScanMatchesSchema.parse(holes)).toBe(holes);
		expect(sdkScanPatternsSchema.parse(holes)).toBe(holes);
		for (const value of [
			null,
			[{}],
			[{ ...pattern, pattern: "x" }],
			[Object.assign(() => 1, pattern)],
		]) {
			expect(sdkScanPatternsSchema.safeParse(value).success).toBe(false);
		}
		expect(
			sdkScanMatchesSchema.safeParse([{ ...match, location: null }]).success,
		).toBe(false);
	});

	test("live field validation keeps read order and stops at the first malformed field", () => {
		const reads: string[] = [];
		const match = {
			get kind() {
				reads.push("kind");
				return "word";
			},
			get value() {
				reads.push("value");
				return "x";
			},
			get location() {
				reads.push("location");
				return "comment";
			},
		};
		const matches = [match];
		expect(sdkScanMatchesSchema.parse(matches)).toBe(matches);
		expect(reads).toEqual(["kind", "value", "location"]);
		reads.length = 0;
		const malformed = {
			get kind() {
				reads.push("kind");
				return 1;
			},
			get value() {
				throw new Error("value must not be read");
			},
		};
		expect(sdkScanMatchesSchema.safeParse([malformed]).success).toBe(false);
		expect(reads).toEqual(["kind"]);
	});

	test("nested comparison envelope parsing does not inspect arguments", () => {
		const args = new Array(1);
		Object.defineProperty(args, "0", {
			get() {
				throw new Error("read argument");
			},
		});
		const inner = Object.create({ kind: "not", args });
		expect(sdkInnerComparisonSchema.parse(inner)).toBe(inner);
		const proxy = new Proxy(
			{},
			{
				get(_target, property) {
					return property === "kind" ? "under" : args;
				},
			},
		);
		expect(sdkInnerComparisonSchema.parse(proxy) === proxy).toBe(true);
		for (const value of [
			null,
			{ kind: "under" },
			{ kind: 1, args: [] },
			Object.assign(() => 1, { kind: "under", args: [] }),
		]) {
			expect(sdkInnerComparisonSchema.safeParse(value).success).toBe(false);
		}
	});

	test("produced type labels retain the error vocabulary", () => {
		for (const value of [0, NaN, Infinity, -Infinity]) {
			expect(sdkProducedTypeSchema.parse(value)).toBe("number");
		}
		for (const value of [null, {}, [], new Date(0), /x/]) {
			expect(sdkProducedTypeSchema.parse(value)).toBe("object");
		}
		expect(sdkProducedTypeSchema.parse(undefined)).toBe("undefined");
		expect(sdkProducedTypeSchema.parse("x")).toBe("string");
		expect(sdkProducedTypeSchema.parse(false)).toBe("boolean");
		expect(sdkProducedTypeSchema.parse(1n)).toBe("bigint");
		expect(sdkProducedTypeSchema.parse(Symbol("x"))).toBe("symbol");
		expect(sdkProducedTypeSchema.parse(() => 1)).toBe("function");
	});
});
