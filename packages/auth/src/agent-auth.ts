import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import {
	DEVICE_CODE_GRANT_TYPE,
	oauthDeviceAuthorization,
	oauthProvider,
	verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import {
	AGENT_IDENTITY_SCOPES,
	AGENT_ORGS_CLAIM,
	AGENT_SCOPES,
	TRIPWIRE_CLI_CLIENT_ID,
	TRIPWIRE_MCP_URL,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { agentServices } from "@tripwire/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";

export const AGENT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const AGENT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AGENT_DEVICE_CODE_TTL = "10m";

const ALL_SCOPES = [...AGENT_IDENTITY_SCOPES, ...AGENT_SCOPES];

export function agentResourceOf(mcpResource: string | undefined): string {
	return mcpResource ?? TRIPWIRE_MCP_URL;
}

function firstPartyClients(db: Db, resource: string): BetterAuthPlugin {
	let ensured: Promise<void> | null = null;
	return {
		id: "tripwire-first-party-clients",
		hooks: {
			before: [
				{
					matcher: (context) => context.path === "/device/code",
					handler: createAuthMiddleware(async () => {
						ensured ??= agentServices
							.ensurePublicAgentClient(db, {
								clientId: TRIPWIRE_CLI_CLIENT_ID,
								name: "Tripwire CLI",
								scopes: ALL_SCOPES,
								grantTypes: [DEVICE_CODE_GRANT_TYPE, "refresh_token"],
								resource: {
									identifier: resource,
									name: "Tripwire MCP",
									allowedScopes: ALL_SCOPES,
								},
							})
							.catch((error: unknown) => {
								ensured = null;
								throw error;
							});
						await ensured;
					}),
				},
			],
		},
	};
}

export function agentAuthPlugins(input: { db: Db; mcpResource?: string }) {
	const resource = agentResourceOf(input.mcpResource);
	return [
		jwt(),
		oauthProvider({
			loginPage: "/login",
			consentPage: "/consent",
			scopes: ALL_SCOPES,
			resources: [
				{
					identifier: resource,
					name: "Tripwire MCP",
					allowedScopes: ALL_SCOPES,
					accessTokenTtl: AGENT_ACCESS_TOKEN_TTL_SECONDS,
				},
			],
			accessTokenExpiresIn: AGENT_ACCESS_TOKEN_TTL_SECONDS,
			refreshTokenExpiresIn: AGENT_REFRESH_TOKEN_TTL_SECONDS,
			refreshTokenReuseInterval: 30,
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			clientRegistrationDefaultApplicationType: "infer",
			clientRegistrationDefaultResources: [resource],
			clientRegistrationDefaultScopes: [
				"openid",
				"profile",
				"offline_access",
				"tripwire:read",
			],
			clientRegistrationAllowedScopes: [...ALL_SCOPES],
			extensions: [
				{
					claims: {
						accessToken: async ({ client, user }) => {
							if (!user) {
								return {};
							}
							const grant = await agentServices.getAgentGrant(input.db, {
								userId: user.id,
								clientId: client.clientId,
							});
							if (!grant) {
								return { [AGENT_ORGS_CLAIM]: [] };
							}
							if (agentServices.agentGrantExpired(grant)) {
								await agentServices.revokeAgent(input.db, {
									userId: user.id,
									clientId: client.clientId,
								});
								throw new APIError("BAD_REQUEST", {
									error: "invalid_grant",
									error_description:
										"This agent connection is older than 30 days. Connect the agent again.",
								});
							}
							return { [AGENT_ORGS_CLAIM]: grant.orgIds };
						},
					},
				},
			],
		}),
		oauthDeviceAuthorization({
			verificationUri: "/device",
			expiresIn: AGENT_DEVICE_CODE_TTL,
			interval: "5s",
		}),
		cimd({ fetchClientMetadataResource }),
		firstPartyClients(input.db, resource),
	];
}

interface RateLimitRule {
	window: number;
	max: number;
}

async function grantTypeOf(request: Request): Promise<string | null> {
	try {
		const copy = request.clone();
		const contentType = copy.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			const body: unknown = await copy.json();
			return typeof body === "object" &&
				body !== null &&
				"grant_type" in body &&
				typeof body.grant_type === "string"
				? body.grant_type
				: null;
		}
		return new URLSearchParams(await copy.text()).get("grant_type");
	} catch {
		return null;
	}
}

export async function oauthTokenRateLimit(
	request: Request,
	current: RateLimitRule,
): Promise<false | RateLimitRule> {
	return (await grantTypeOf(request)) === DEVICE_CODE_GRANT_TYPE
		? false
		: current;
}

export const agentRateLimitRules = {
	"/oauth2/token": oauthTokenRateLimit,
};

export async function verifySignedOAuthQuery(
	query: string,
	secret: string,
): Promise<boolean> {
	return Boolean(await verifyOAuthQueryParams(query, secret));
}
