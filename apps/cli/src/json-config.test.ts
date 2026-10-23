import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeServerEntry, writeServerEntry } from "#/json-config";

const URL = "https://mcp.tripwire.sh/mcp";
const dirs: string[] = [];

function tempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "tripwire-json-"));
	dirs.push(dir);
	return join(dir, "nested", "mcp.json");
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("mergeServerEntry", () => {
	test("creates the file shape from nothing", () => {
		const merged = mergeServerEntry(null, "x", "mcpServers", "tripwire", {
			url: URL,
		});
		expect(merged.outcome).toBe("added");
		expect(JSON.parse(merged.text)).toEqual({
			mcpServers: { tripwire: { url: URL } },
		});
	});

	test("keeps other servers and top-level keys", () => {
		const before = JSON.stringify({
			theme: "dark",
			mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } },
		});
		const merged = mergeServerEntry(before, "x", "mcpServers", "tripwire", {
			url: URL,
		});
		expect(JSON.parse(merged.text)).toEqual({
			theme: "dark",
			mcpServers: {
				linear: { url: "https://mcp.linear.app/mcp" },
				tripwire: { url: URL },
			},
		});
	});

	test("is idempotent", () => {
		const once = mergeServerEntry(null, "x", "mcpServers", "tripwire", {
			url: URL,
		});
		const twice = mergeServerEntry(once.text, "x", "mcpServers", "tripwire", {
			url: URL,
		});
		expect(twice.outcome).toBe("unchanged");
		expect(twice.text).toBe(once.text);
	});

	test("updates the url and keeps user fields on our entry", () => {
		const before = JSON.stringify({
			mcpServers: {
				tripwire: { url: "https://old.example/mcp", headers: { X: "1" } },
			},
		});
		const merged = mergeServerEntry(before, "x", "mcpServers", "tripwire", {
			url: URL,
		});
		expect(merged.outcome).toBe("updated");
		expect(JSON.parse(merged.text).mcpServers.tripwire).toEqual({
			url: URL,
			headers: { X: "1" },
		});
	});

	test("refuses to touch invalid json", () => {
		expect(() =>
			mergeServerEntry("{ not json", "cfg", "mcpServers", "tripwire", {
				url: URL,
			}),
		).toThrow("cfg is not a JSON object");
		expect(() =>
			mergeServerEntry("[]", "cfg", "mcpServers", "tripwire", { url: URL }),
		).toThrow("not a JSON object");
		expect(() =>
			mergeServerEntry('{"mcpServers": 3}', "cfg", "mcpServers", "tripwire", {
				url: URL,
			}),
		).toThrow("not an object");
	});
});

describe("writeServerEntry", () => {
	test("writes, then leaves the file alone on a second run", () => {
		const path = tempFile();
		expect(
			writeServerEntry(path, "servers", "tripwire", { type: "http", url: URL }),
		).toBe("added");
		const first = readFileSync(path, "utf8");
		expect(
			writeServerEntry(path, "servers", "tripwire", { type: "http", url: URL }),
		).toBe("unchanged");
		expect(readFileSync(path, "utf8")).toBe(first);
	});

	test("does not clobber a broken file", () => {
		const path = tempFile();
		writeServerEntry(path, "mcpServers", "other", { url: "https://a.example" });
		writeFileSync(path, "{ broken");
		expect(() =>
			writeServerEntry(path, "mcpServers", "tripwire", { url: URL }),
		).toThrow();
		expect(readFileSync(path, "utf8")).toBe("{ broken");
	});
});
