import { createHash } from "node:crypto";
import {
	GITCAFE_ISSUER,
	type GitCafeOidcClient,
	gitCafeOidcClaimsSchema,
	gitCafeOidcClientSchema,
} from "@tripwire/contracts";
import type { BetterAuthPlugin } from "better-auth";
import {
	createAuthorizationURL,
	type OAuthProvider,
	validateAuthorizationCode,
	validateToken,
} from "better-auth/oauth2";

const NONCE_PREFIX = "gitcafe-oidc-nonce:";
const FLOW_LIFETIME_MS = 10 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 30;

export function resolveGitCafeSignIn(input: {
	enabled: string | undefined;
	clientId: string | undefined;
}): GitCafeOidcClient | null {
	if (input.enabled === undefined || input.enabled === "false") {
		return null;
	}
	if (input.enabled !== "true") {
		throw new Error("GITCAFE_SIGN_IN_ENABLED must be true or false");
	}
	const parsed = gitCafeOidcClientSchema.safeParse({
		clientId: input.clientId,
	});
	if (!parsed.success) {
		throw new Error("GitCafe sign-in requires GITCAFE_CLIENT_ID");
	}
	return parsed.data;
}

/** Pin GitCafe's public-client protocol without the generic plugin's userinfo fallback. */
export function gitCafeOidc(input: GitCafeOidcClient): BetterAuthPlugin {
	const { clientId } = gitCafeOidcClientSchema.parse(input);
	return {
		id: "tripwire-gitcafe-oidc",
		init(ctx) {
			const provider: OAuthProvider = {
				id: "gitcafe",
				name: "GitCafe",
				issuer: GITCAFE_ISSUER,
				requiresIdTokenNonce: true,
				accountSubject: ({ profile }) =>
					gitCafeOidcClaimsSchema.parse(profile).sub,
				async createAuthorizationURL(data) {
					if (!data.idTokenNonce || !data.codeVerifier) {
						throw new Error(
							"GitCafe requires a server nonce and PKCE verifier",
						);
					}
					await ctx.internalAdapter.createVerificationValue({
						identifier: NONCE_PREFIX + data.idTokenNonce,
						value: "pending",
						expiresAt: new Date(Date.now() + FLOW_LIFETIME_MS),
					});
					return createAuthorizationURL({
						id: "gitcafe",
						options: { clientId },
						authorizationEndpoint: `${GITCAFE_ISSUER}/api/oauth/authorize`,
						state: data.state,
						codeVerifier: data.codeVerifier,
						nonce: data.idTokenNonce,
						redirectURI: data.redirectURI,
						scopes: ["openid", "profile", "email"],
					});
				},
				validateAuthorizationCode(data) {
					return validateAuthorizationCode({
						...data,
						options: { clientId },
						tokenEndpoint: `${GITCAFE_ISSUER}/api/oauth/token`,
						tokenEndpointAuth: { method: "none" },
					});
				},
				async getUserInfo(tokens) {
					if (
						!(
							tokens.idToken &&
							tokens.accessToken &&
							tokens.expectedIdTokenNonce
						)
					) {
						return null;
					}
					try {
						const verified = await validateToken(
							tokens.idToken,
							`${GITCAFE_ISSUER}/api/oauth/jwks`,
							{
								issuer: GITCAFE_ISSUER,
								audience: clientId,
								algorithms: ["RS256"],
								requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
								clockTolerance: CLOCK_TOLERANCE_SECONDS,
							},
						);
						const parsed = gitCafeOidcClaimsSchema.safeParse(verified.payload);
						if (!parsed.success) {
							return null;
						}
						const claims = parsed.data;
						const now = Date.now() / 1000;
						const accessTokenHash = createHash("sha256")
							.update(tokens.accessToken)
							.digest()
							.subarray(0, 16)
							.toString("base64url");
						if (
							claims.aud !== clientId ||
							(claims.azp !== undefined && claims.azp !== clientId) ||
							claims.nonce !== tokens.expectedIdTokenNonce ||
							claims.at_hash !== accessTokenHash ||
							claims.iat > now + CLOCK_TOLERANCE_SECONDS ||
							claims.iat <
								now - FLOW_LIFETIME_MS / 1000 - CLOCK_TOLERANCE_SECONDS ||
							claims.exp <= claims.iat
						) {
							return null;
						}
						/** OAuth state uses read-then-delete; this additional nonce is consumed atomically. */
						if (
							!(await ctx.internalAdapter.consumeVerificationValue(
								NONCE_PREFIX + claims.nonce,
							))
						) {
							return null;
						}
						return {
							user: {
								name: claims.name || claims.preferred_username,
								email: claims.email,
								emailVerified: true,
								image: claims.picture,
							},
							data: claims,
						};
					} catch {
						return null;
					}
				},
			};
			return {
				context: { socialProviders: [...ctx.socialProviders, provider] },
			};
		},
	};
}
