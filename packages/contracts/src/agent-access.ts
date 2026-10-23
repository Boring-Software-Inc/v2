import { z } from "zod";

export const AGENT_SCOPES = [
	"tripwire:read",
	"tripwire:configure",
	"tripwire:moderate",
	"tripwire:admin",
] as const;

export const agentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof agentScopeSchema>;

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
