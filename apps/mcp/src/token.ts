import {
	AGENT_IDENTITY_SCOPES,
	AGENT_ORGS_CLAIM,
	AGENT_SCOPES,
	type AgentScope,
	agentAccessClaimsSchema,
	agentScopesOf,
} from "@tripwire/contracts";
import {
	requestToResourceInput,
	verifyAccessTokenRequest,
} from "better-auth/oauth2";
import { type McpConfig, protectedResourceMetadataUrl } from "./config.ts";

export interface VerifiedAgent {
	userId: string;
	clientId: string;
	scopes: AgentScope[];
	orgIds: string[];
}

export type TokenCheck =
	| { ok: true; agent: VerifiedAgent }
	| { ok: false; reason: "missing" | "invalid" };

export async function verifyAgentToken(
	request: Request,
	config: McpConfig,
): Promise<TokenCheck> {
	const header = request.headers.get("authorization");
	if (!header) {
		return { ok: false, reason: "missing" };
	}
	try {
		const payload = await verifyAccessTokenRequest(
			requestToResourceInput(request),
			{
				verifyOptions: { issuer: config.issuer, audience: config.resource },
				jwksUrl: config.jwksUrl,
			},
		);
		const claims = agentAccessClaimsSchema.safeParse(payload);
		const clientId = claims.success
			? (claims.data.azp ?? claims.data.client_id)
			: undefined;
		if (!(claims.success && clientId)) {
			return { ok: false, reason: "invalid" };
		}
		return {
			ok: true,
			agent: {
				userId: claims.data.sub,
				clientId,
				scopes: agentScopesOf(claims.data.scope),
				orgIds: claims.data[AGENT_ORGS_CLAIM] ?? [],
			},
		};
	} catch {
		return { ok: false, reason: "invalid" };
	}
}

export function challengeScopes(readOnly: boolean): string {
	const scopes: string[] = readOnly
		? [...AGENT_IDENTITY_SCOPES, "tripwire:read"]
		: [...AGENT_IDENTITY_SCOPES, ...AGENT_SCOPES];
	return scopes.join(" ");
}

function jsonRpcError(status: number, message: string, header: string) {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code: -32001, message },
			id: null,
		}),
		{
			status,
			headers: {
				"content-type": "application/json",
				"www-authenticate": header,
			},
		},
	);
}

export function unauthorized(
	config: McpConfig,
	reason: "missing" | "invalid",
	readOnly: boolean,
): Response {
	const parts = [
		`resource_metadata="${protectedResourceMetadataUrl(config.resource)}"`,
		`scope="${challengeScopes(readOnly)}"`,
	];
	if (reason === "invalid") {
		parts.unshift('error="invalid_token"');
	}
	return jsonRpcError(
		401,
		reason === "missing"
			? "Sign in to Tripwire to use this server."
			: "This Tripwire sign-in is no longer valid. Sign in again.",
		`Bearer ${parts.join(", ")}`,
	);
}

export function insufficientScope(
	config: McpConfig,
	scopes: AgentScope[],
): Response {
	return jsonRpcError(
		403,
		`This tool needs more access: ${scopes.join(" ")}. Sign in again and allow it.`,
		`Bearer error="insufficient_scope", scope="${[...AGENT_IDENTITY_SCOPES, ...scopes].join(" ")}", resource_metadata="${protectedResourceMetadataUrl(config.resource)}"`,
	);
}

export function protectedResourceMetadata(config: McpConfig) {
	return {
		resource: config.resource,
		authorization_servers: [config.issuer],
		scopes_supported: [...AGENT_IDENTITY_SCOPES, ...AGENT_SCOPES],
		bearer_methods_supported: ["header"],
		resource_name: "Tripwire",
		resource_documentation: `${config.appUrl}/`,
	};
}
