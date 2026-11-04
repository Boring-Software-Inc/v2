import { describe, expect, test } from "bun:test";
import { mcpToolCallScopeProbeSchema } from "./agent-access.ts";

describe("mcpToolCallScopeProbeSchema", () => {
	test("projects only the scope-relevant fields without validating the envelope", () => {
		for (const envelope of [
			{},
			{ jsonrpc: "invalid", id: { invalid: true } },
			{ jsonrpc: "2.0", id: "call-id" },
		]) {
			const message = {
				...envelope,
				method: "tools/call",
				params: { name: "set_rule", arguments: null, extra: true },
			};
			expect(mcpToolCallScopeProbeSchema.parse(message)).toEqual({
				method: "tools/call",
				params: { name: "set_rule" },
			});
			expect(message.params).toEqual({
				name: "set_rule",
				arguments: null,
				extra: true,
			});
		}
	});

	test("ignores non-calls and malformed HTTP JSON members", () => {
		for (const message of [
			undefined,
			null,
			false,
			1,
			"tools/call",
			[],
			{},
			{ method: "initialize" },
			{ method: "tools/list" },
			{ method: "tools/call" },
			{ method: "tools/call", params: null },
			{ method: "tools/call", params: [] },
			{ method: "tools/call", params: { name: 1 } },
		]) {
			expect(mcpToolCallScopeProbeSchema.safeParse(message).success).toBe(
				false,
			);
		}
	});

	test("leaves unknown tool names for the catalog and SDK to classify", () => {
		expect(
			mcpToolCallScopeProbeSchema.parse({
				method: "tools/call",
				params: { name: "unknown_tool" },
			}),
		).toEqual({ method: "tools/call", params: { name: "unknown_tool" } });
	});
});
