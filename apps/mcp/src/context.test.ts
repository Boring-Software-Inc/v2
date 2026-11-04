import { describe, expect, test } from "bun:test";
import { ok } from "./context.ts";

describe("ok", () => {
	test("keeps exact native pretty JSON in the MCP text block", () => {
		const value = {
			date: new Date("2026-10-01T02:03:04.000Z"),
			omitted: undefined,
			list: [undefined, { saved: true }],
		};
		expect(ok(value)).toEqual({
			content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		});
		const omitted = ok(undefined);
		expect(omitted.content).toHaveLength(1);
		expect(omitted.content[0]).toHaveProperty("type", "text");
		expect(omitted.content[0]).toHaveProperty("text", undefined);
	});

	test("serializes once and propagates native serialization failures", () => {
		let calls = 0;
		expect(
			ok({
				toJSON() {
					return { calls: ++calls };
				},
			}),
		).toEqual({
			content: [{ type: "text", text: '{\n  "calls": 1\n}' }],
		});
		expect(calls).toBe(1);
		expect(() => ok(1n)).toThrow(TypeError);
	});
});
