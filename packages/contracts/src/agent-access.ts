import { z } from "zod";

export const AGENT_SCOPES = [
	"tripwire:read",
	"tripwire:configure",
	"tripwire:moderate",
	"tripwire:admin",
] as const;

export const agentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof agentScopeSchema>;

/** Scope inspection only; the SDK owns JSON-RPC envelope and argument validation. */
export const mcpToolCallScopeProbeSchema = z.object(
	{
		method: z.literal("tools/call", { error: "Not a tool call" }),
		params: z.object(
			{ name: z.string({ error: "Tool name must be a string" }) },
			{ error: "Tool parameters must be an object" },
		),
	},
	{ error: "Tool call must be an object" },
);
export type McpToolCallScopeProbe = z.infer<typeof mcpToolCallScopeProbeSchema>;

export const AGENT_IDENTITY_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
] as const;

export const AGENT_ORGS_CLAIM = "https://tripwire.sh/orgs";

export const TRIPWIRE_CLI_CLIENT_ID = "tripwire-cli";

export const agentAccessClaimsSchema = z.object({
	sub: z.string().min(1),
	azp: z.string().min(1).optional(),
	client_id: z.string().min(1).optional(),
	scope: z.string().optional(),
	[AGENT_ORGS_CLAIM]: z.array(z.string()).optional(),
});
export type AgentAccessClaims = z.infer<typeof agentAccessClaimsSchema>;

export function agentScopesOf(scope: string | undefined): AgentScope[] {
	return (scope ?? "").split(" ").flatMap((value) => {
		const parsed = agentScopeSchema.safeParse(value);
		return parsed.success ? [parsed.data] : [];
	});
}
