import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const TEST_TOKEN = "test-token-not-real";

export const TOOL_NAMES = [
	"whoami",
	"setup_status",
	"list_repos",
	"get_install_link",
	"list_rule_catalog",
	"get_repo_rules",
	"set_rule",
	"turn_on_gate",
	"list_workflows",
	"set_workflow_enabled",
	"list_runs",
	"get_run",
	"list_moderation_queue",
	"decide_moderation",
	"report_setup_progress",
] as const;

export interface ToolCall {
	name: string;
	args: z.infer<ReturnType<typeof z.json>>;
}

export interface FakeServer {
	url: string;
	calls: ToolCall[];
	stop(): Promise<void>;
}

function reply(name: string, args: z.infer<ReturnType<typeof z.json>>) {
	if (name === "whoami") {
		const data = {
			login: "octocat",
			accessStatus: "approved",
			orgs: [{ slug: "acme", role: "admin" }],
		};
		return {
			content: [
				{
					type: "text" as const,
					text: "octocat, approved, orgs: acme (admin)",
				},
			],
			structuredContent: data,
		};
	}
	if (name === "decide_moderation") {
		const confirmUrl = "https://app.tripwire.sh/acme/confirm/ban_123";
		return {
			content: [
				{ type: "text" as const, text: "Ban needs a human to confirm." },
			],
			structuredContent: { status: "needs_confirmation", confirmUrl },
		};
	}
	if (name === "get_run") {
		return {
			content: [{ type: "text" as const, text: "run not found" }],
			isError: true,
		};
	}
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify({ tool: name, args }) },
		],
	};
}

function buildServer(calls: ToolCall[]): McpServer {
	const server = new McpServer({ name: "fake-tripwire", version: "0.0.0" });
	for (const name of TOOL_NAMES) {
		server.registerTool(
			name,
			{ description: name, inputSchema: z.looseObject({}) },
			async (args) => {
				const parsed = z.json().parse(args);
				calls.push({ name, args: parsed });
				return reply(name, parsed);
			},
		);
	}
	return server;
}

export function startFakeServer(): FakeServer {
	const calls: ToolCall[] = [];
	const http = Bun.serve({
		port: 0,
		async fetch(request) {
			if (request.headers.get("authorization") !== `Bearer ${TEST_TOKEN}`) {
				return new Response("unauthorized", { status: 401 });
			}
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			});
			const server = buildServer(calls);
			await server.connect(transport);
			return transport.handleRequest(request);
		},
	});
	return {
		url: `http://127.0.0.1:${http.port}/mcp`,
		calls,
		stop: async () => {
			await http.stop(true);
		},
	};
}
