import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { callTool } from "#/mcp-client";
import {
	cannedResult,
	type FakeServer,
	startFakeServer,
	TEST_TOKEN,
} from "./fake-server";

let server: FakeServer;

beforeAll(() => {
	server = startFakeServer();
});
afterAll(async () => {
	await server.stop();
});

describe("fake-server tables", () => {
	test.each([
		"toString",
		"constructor",
		"__proto__",
		"unknown-tool",
	])("undeclared canned result %s returns null", (name) => {
		expect(cannedResult(name)).toBeNull();
	});

	test("declared canned results keep their payloads", () => {
		expect(cannedResult("delete_custom_rule")).toEqual({
			deleted: true,
			id: "custom-not-into-release-1a2b3c",
			repo: "grim/scratch",
		});
	});

	test("strict tools reject missing required arguments", async () => {
		const output = await callTool(
			{ token: TEST_TOKEN, mcpUrl: server.url, source: "env" },
			"list_moderation_queue",
			{},
		);
		expect(output.isError).toBe(true);
		expect(output.text).toContain(
			"Invalid arguments for tool list_moderation_queue",
		);
	});

	test("strict tools with valid arguments use the fallback reply", async () => {
		const args = { repo: "scratch" };
		const output = await callTool(
			{ token: TEST_TOKEN, mcpUrl: server.url, source: "env" },
			"list_moderation_queue",
			args,
		);
		expect(output).toEqual({
			isError: false,
			text: JSON.stringify({ tool: "list_moderation_queue", args }, null, 2),
			data: { tool: "list_moderation_queue", args },
		});
	});

	test("tools without strict schemas preserve loose arguments", async () => {
		const args = { extra: { enabled: false }, list: [1, null] };
		const output = await callTool(
			{ token: TEST_TOKEN, mcpUrl: server.url, source: "env" },
			"report_setup_progress",
			args,
		);
		expect(output.data).toEqual({ tool: "report_setup_progress", args });
	});
});
