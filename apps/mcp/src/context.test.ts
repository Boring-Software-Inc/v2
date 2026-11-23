import { describe, expect, test } from "bun:test";
import { guard, ok, ToolError } from "./context.ts";

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

describe("guard", () => {
	test("returns expected tool errors without reporting them", async () => {
		const reported: unknown[] = [];
		expect(
			await guard(
				async () => {
					throw new ToolError("expected");
				},
				(error) => reported.push(error),
			),
		).toMatchObject({
			isError: true,
			structuredContent: { error: "expected" },
		});
		expect(reported).toEqual([]);
	});

	test("reports unexpected tool errors before preserving SDK handling", async () => {
		const failure = new Error("database unavailable");
		const reported: unknown[] = [];
		await expect(
			guard(
				async () => {
					throw failure;
				},
				(error) => reported.push(error),
			),
		).rejects.toBe(failure);
		expect(reported).toEqual([failure]);
	});
});
