import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NotSignedInError, type Session } from "#/auth/session";
import { VERSION } from "#/config";

export type ToolArgs = Record<string, z.infer<ReturnType<typeof z.json>>>;

export interface ToolOutput {
	isError: boolean;
	text: string;
	data: z.infer<ReturnType<typeof z.json>> | null;
}

function parseJson(text: string): z.infer<ReturnType<typeof z.json>> | null {
	try {
		const parsed = z.json().safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function isUnauthorized(error: Error): boolean {
	if (error instanceof StreamableHTTPError && error.code === 401) {
		return true;
	}
	return /\b401\b|unauthorized/i.test(error.message);
}

export async function callTool(
	session: Session,
	name: string,
	args: ToolArgs,
	fetchImpl?: typeof fetch,
): Promise<ToolOutput> {
	const transport = new StreamableHTTPClientTransport(new URL(session.mcpUrl), {
		requestInit: { headers: { Authorization: `Bearer ${session.token}` } },
		fetch: fetchImpl,
	});
	const client = new Client({ name: "tripwire-cli", version: VERSION });
	try {
		await client.connect(transport);
		const raw = await client.callTool(
			{ name, arguments: args },
			CallToolResultSchema,
		);
		const result = CallToolResultSchema.parse(raw);
		const text = result.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n");
		const structured = result.structuredContent
			? z.json().safeParse(result.structuredContent)
			: null;
		return {
			isError: result.isError === true,
			text,
			data: structured?.success ? structured.data : parseJson(text),
		};
	} catch (error) {
		if (error instanceof Error && isUnauthorized(error)) {
			throw new NotSignedInError(
				"The Tripwire server rejected the token. Run tripwire login.",
			);
		}
		throw error;
	} finally {
		await client.close().catch(() => undefined);
	}
}
