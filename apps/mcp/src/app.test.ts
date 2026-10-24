import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@tripwire/db";
import type { Pool } from "pg";
import pino from "pino";
import { createApp } from "./app.ts";
import { selectTools, TOOL_NAMES, TOOL_SPECS, toolVisible } from "./catalog.ts";
import { readConfig } from "./config.ts";

const config = readConfig({
	BETTER_AUTH_SECRET: "test-secret",
	APP_URL: "http://localhost:3420",
	MCP_PUBLIC_URL: "http://localhost:3421/mcp",
});

const app = createApp({
	db: {} as Db,
	pool: {} as Pool,
	getBoss: () => Promise.reject(new Error("no queue in tests")),
	config,
	logger: pino({ level: "silent" }),
});

describe("protected resource metadata", () => {
	test("names the resource and the authorization server", async () => {
		const res = await app.request("/.well-known/oauth-protected-resource/mcp");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			resource: "http://localhost:3421/mcp",
			authorization_servers: ["http://localhost:3420/api/auth"],
			bearer_methods_supported: ["header"],
		});
	});
});

describe("mcp challenge", () => {
	test("no token gets a 401 that points at the metadata", async () => {
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		});
		expect(res.status).toBe(401);
		const header = res.headers.get("www-authenticate") ?? "";
		expect(header).toContain(
			'resource_metadata="http://localhost:3421/.well-known/oauth-protected-resource/mcp"',
		);
		expect(header).toContain("tripwire:admin");
		expect(header).not.toContain("invalid_token");
	});

	test("a forged token is invalid_token", async () => {
		const res = await app.request("/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer not.a.jwt",
			},
			body: "{}",
		});
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toContain(
			'error="invalid_token"',
		);
	});

	test("read_only narrows the challenged scopes", async () => {
		const res = await app.request("/mcp?read_only=1", { method: "POST" });
		const header = res.headers.get("www-authenticate") ?? "";
		expect(header).toContain("tripwire:read");
		expect(header).not.toContain("tripwire:admin");
	});

	test("an unknown skill is a 400", async () => {
		const res = await app.request("/mcp?skills=everything", { method: "POST" });
		expect(res.status).toBe(400);
	});
});

describe("tool selection", () => {
	test("skills keep read tools and drop the rest", () => {
		const selection = selectTools(new URL("http://x/mcp?skills=configure"));
		if (!selection.ok) {
			throw new Error("expected a selection");
		}
		expect(toolVisible("set_rule", selection)).toBe(true);
		expect(toolVisible("setup_status", selection)).toBe(true);
		expect(toolVisible("turn_on_gate", selection)).toBe(false);
		expect(toolVisible("report_setup_progress", selection)).toBe(true);
	});

	test("read_only hides every write tool", () => {
		const selection = selectTools(new URL("http://x/mcp?read_only=true"));
		if (!selection.ok) {
			throw new Error("expected a selection");
		}
		expect(toolVisible("set_rule", selection)).toBe(false);
		expect(toolVisible("decide_moderation", selection)).toBe(false);
		expect(toolVisible("get_repo_rules", selection)).toBe(true);
	});

	test("a role sees the org shell and only the tools its region scopes allow", () => {
		const selection = selectTools(new URL("http://x/mcp"));
		if (!selection.ok) {
			throw new Error("expected a selection");
		}
		const listed = TOOL_NAMES.filter((name) =>
			toolVisible(name, { ...selection, permissions: ["moderation:read"] }),
		);
		expect(listed).toEqual([
			"whoami",
			"setup_status",
			"list_repos",
			"list_rule_catalog",
			"list_moderation_queue",
			"report_setup_progress",
		]);
	});

	test("without a role filter every scoped tool is listed", () => {
		const selection = selectTools(new URL("http://x/mcp"));
		if (!selection.ok) {
			throw new Error("expected a selection");
		}
		expect(TOOL_NAMES.filter((name) => toolVisible(name, selection))).toEqual([
			...TOOL_NAMES,
		]);
	});

	test("disable-skills cannot remove everything", () => {
		expect(
			selectTools(new URL("http://x/mcp?skills=admin&disable-skills=admin")).ok,
		).toBe(false);
	});
});

describe("tool access classification", () => {
	test("every tool names a region scope, the org shell, or no org", () => {
		const byNeed = Object.fromEntries(
			TOOL_NAMES.map((name) => [name, TOOL_SPECS[name].need]),
		);
		expect(byNeed).toEqual({
			whoami: "none",
			setup_status: "org-shell",
			list_repos: "org-shell",
			get_install_link: "connections:manage",
			list_rule_catalog: "none",
			get_repo_rules: "rules:read",
			set_rule: "rules:manage",
			turn_on_gate: "connections:manage",
			list_workflows: "workflows:read",
			set_workflow_enabled: "workflows:manage",
			get_workflow: "workflows:read",
			validate_workflow: "workflows:read",
			apply_workflow: "workflows:manage",
			propose_workflow_push: "workflows:manage",
			get_workflow_push: "workflows:read",
			list_runs: "activity:read",
			get_run: "activity:read",
			list_moderation_queue: "moderation:read",
			decide_moderation: "moderation:manage",
			report_setup_progress: "none",
		});
	});

	test("handlers read their access from the catalog", () => {
		const source = readFileSync(join(import.meta.dir, "tools.ts"), "utf8");
		const checked = [
			...source.matchAll(
				/(?:resolveOrg|resolveOrgRepo|scoped)\(\s*(?:\w+,\s*)+"([^"]+)",?\s*\)/g,
			),
		].map((match) => match[1]);
		expect(checked.sort()).toEqual(
			TOOL_NAMES.filter((name) => TOOL_SPECS[name].need !== "none").sort(),
		);
	});
});
