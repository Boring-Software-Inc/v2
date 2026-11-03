import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configuredUrl, formatCommand } from "#/agents/shell";
import { makeSandbox, type Sandbox } from "../../test/sandbox";

let sandbox: Sandbox;
let path: string;

beforeEach(() => {
	sandbox = makeSandbox();
	path = join(sandbox.home, "config.jsonc");
});

afterEach(() => sandbox.cleanup());

describe("configuredUrl", () => {
	test("missing files are absent", () => {
		expect(configuredUrl(path, "mcpServers", "tripwire")).toBeNull();
	});

	test.each([
		"{broken",
		"null",
		"[]",
		"3",
		"{}",
		'{"mcpServers":null}',
		'{"mcpServers":[]}',
		'{"mcpServers":{"other":{"url":"other"}}}',
	])("absent or invalid config returns null: %s", (text) => {
		writeFileSync(path, text);
		expect(configuredUrl(path, "mcpServers", "tripwire")).toBeNull();
		expect(readFileSync(path, "utf8")).toBe(text);
	});

	test.each([
		"null",
		"[]",
		"3",
		'"url"',
		"{}",
		'{"url":false}',
		'{"url":17}',
	])("present but malformed entry returns an empty string: %s", (entry) => {
		writeFileSync(path, `{"mcpServers":{"tripwire":${entry}}}`);
		expect(configuredUrl(path, "mcpServers", "tripwire")).toBe("");
	});

	test("JSONC accepts comments and trailing commas without rewriting", () => {
		const text =
			'// mine\n{"mcpServers":{"tripwire":{"url":"https://example/mcp",},},}';
		writeFileSync(path, text);
		expect(configuredUrl(path, "mcpServers", "tripwire")).toBe(
			"https://example/mcp",
		);
		expect(readFileSync(path, "utf8")).toBe(text);
	});

	test.each([
		[{ url: false, serverUrl: "second" }, "second"],
		[{ url: "first", serverUrl: "second" }, "first"],
		[{ url: "", serverUrl: "second" }, ""],
	] as const)("uses the first string field, including empty strings: %j", (entry, expected) => {
		writeFileSync(path, JSON.stringify({ mcpServers: { tripwire: entry } }));
		expect(
			configuredUrl(path, "mcpServers", "tripwire", ["url", "serverUrl"]),
		).toBe(expected);
	});
});

describe("formatCommand", () => {
	test("leaves safe arguments unchanged", () => {
		expect(
			formatCommand("agent", ["mcp", "--url", "https://example/mcp"]),
		).toBe("agent mcp --url https://example/mcp");
	});

	test("shell evaluation preserves hostile arguments literally", async () => {
		const args = [
			"",
			"two words",
			"it's quoted",
			"$(touch injected)",
			"`touch injected`",
			"; touch injected",
			"line\nbreak",
			"*",
			"https://example/mcp?x=1&y=2",
		];
		const command = formatCommand("printf", ["%s\\0", ...args]);
		const child = Bun.spawn(["/bin/sh", "-c", command], {
			cwd: sandbox.root,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await new Response(child.stdout).text()).toBe(
			`${args.join("\0")}\0`,
		);
		expect(await new Response(child.stderr).text()).toBe("");
		expect(await child.exited).toBe(0);
		expect(existsSync(join(sandbox.root, "injected"))).toBe(false);
	});
});
