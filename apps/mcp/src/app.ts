import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { assertApproved } from "@tripwire/auth/access-gate";
import type { AgentScope } from "@tripwire/contracts";
import { agentServices, type Db } from "@tripwire/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import {
	selectTools,
	TOOL_NAMES,
	TOOL_SPECS,
	type ToolName,
} from "./catalog.ts";
import type { McpConfig } from "./config.ts";
import {
	insufficientScope,
	protectedResourceMetadata,
	unauthorized,
	verifyAgentToken,
} from "./token.ts";
import { registerTools } from "./tools.ts";

export interface McpDeps {
	db: Db;
	pool: Pool;
	getBoss: () => Promise<PgBoss>;
	config: McpConfig;
	logger: Logger;
}

const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

function calledTools(body: unknown): ToolName[] {
	const messages = Array.isArray(body) ? body : [body];
	return messages.flatMap((message) => {
		if (
			typeof message === "object" &&
			message !== null &&
			"method" in message &&
			message.method === "tools/call" &&
			"params" in message &&
			typeof message.params === "object" &&
			message.params !== null &&
			"name" in message.params &&
			typeof message.params.name === "string" &&
			TOOL_NAME_SET.has(message.params.name)
		) {
			return [message.params.name as ToolName];
		}
		return [];
	});
}

export function createApp(deps: McpDeps) {
	const { config, db, logger } = deps;
	const mcpPath = new URL(config.resource).pathname || "/mcp";
	const app = new Hono();

	app.use(
		"*",
		cors({
			origin: "*",
			allowHeaders: [
				"authorization",
				"content-type",
				"mcp-protocol-version",
				"mcp-session-id",
				"last-event-id",
			],
			exposeHeaders: ["www-authenticate", "mcp-session-id"],
		}),
	);

	app.get("/health", (c) => c.json({ ok: true }));

	const metadata = (c: { json: (body: unknown) => Response }) =>
		c.json(protectedResourceMetadata(config));
	app.get("/.well-known/oauth-protected-resource", metadata);
	app.get(`/.well-known/oauth-protected-resource${mcpPath}`, metadata);

	app.all(mcpPath, async (c) => {
		const request = c.req.raw;
		const selection = selectTools(new URL(request.url));
		if (!selection.ok) {
			return c.json(
				{
					jsonrpc: "2.0",
					error: { code: -32602, message: selection.message },
					id: null,
				},
				400,
			);
		}
		const token = await verifyAgentToken(request, config);
		if (!token.ok) {
			return unauthorized(config, token.reason, selection.readOnly);
		}
		const grant = await agentServices.getAgentGrant(db, {
			userId: token.agent.userId,
			clientId: token.agent.clientId,
		});
		if (!grant || agentServices.agentGrantExpired(grant)) {
			return unauthorized(config, "invalid", selection.readOnly);
		}
		const agent = {
			...token.agent,
			orgIds: token.agent.orgIds.filter((id) => grant.orgIds.includes(id)),
		};

		let body: unknown;
		if (request.method === "POST") {
			try {
				body = await request.json();
			} catch {
				return c.json(
					{
						jsonrpc: "2.0",
						error: { code: -32700, message: "Parse error" },
						id: null,
					},
					400,
				);
			}
			const missing = [
				...new Set(
					calledTools(body)
						.map((name) => TOOL_SPECS[name].scope)
						.filter((scope) => !agent.scopes.includes(scope)),
				),
			] as AgentScope[];
			if (missing.length > 0) {
				return insufficientScope(config, missing);
			}
		}

		const denial = await assertApproved(db, agent.userId);
		agentServices
			.touchAgentGrant(db, { userId: agent.userId, clientId: agent.clientId })
			.catch((error: unknown) => {
				logger.warn({ error }, "agent grant touch failed");
			});

		const server = new McpServer({ name: "tripwire", version: "1.0.0" });
		registerTools(
			server,
			{
				db,
				pool: deps.pool,
				getBoss: deps.getBoss,
				config,
				agent,
				accessDenied: denial
					? `Your Tripwire access is not approved yet. Request access at ${config.appUrl}/queue and try again once you are in.`
					: null,
			},
			selection,
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		return await transport.handleRequest(
			request,
			body === undefined ? undefined : { parsedBody: body },
		);
	});

	return app;
}
