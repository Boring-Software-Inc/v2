import { createHmac } from "node:crypto";
import {
	GITCAFE_API_RESOURCE,
	GITCAFE_CONNECT_SCOPES,
	GITCAFE_ISSUER,
	type GitCafeConnectFailureCode,
	type GitCafeConnectFlow,
	type GitCafeOidcClient,
	gitCafeConnectCallbackSchema,
	gitCafeConnectFailureSchema,
	gitCafeConnectFlowSchema,
	gitCafeConnectPrincipalSchema,
	gitCafeConnectProofReadSchema,
	gitCafeConnectProofSchema,
	gitCafeConnectRequestSchema,
	gitCafeConnectStoredStateSchema,
	gitCafeConnectUserInfoSchema,
	gitCafeOidcClientSchema,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
	APIError,
	addOAuthServerContext,
	createAuthEndpoint,
	createAuthMiddleware,
	getAuthoritativeSessionFromCtx,
	getOAuthState,
} from "better-auth/api";
import {
	generateRandomString,
	symmetricDecrypt,
	symmetricEncrypt,
} from "better-auth/crypto";
import {
	createAuthorizationURL,
	generateState,
	parseState,
	validateAuthorizationCode,
} from "better-auth/oauth2";
import { verifyGitCafeClaims } from "./gitcafe-oidc.ts";
import { memberPermissions } from "./org-gate.ts";

const FLOW_PREFIX = "gitcafe-connect-flow:";
const NONCE_PREFIX = "gitcafe-connect-nonce:";
const PROOF_PREFIX = "gitcafe-connect-proof:";
const LIFETIME_MS = 5 * 60 * 1000;

function refused(
	code?: GitCafeConnectFailureCode,
	providerStatus?: number,
): never {
	throw new APIError(
		"FORBIDDEN",
		gitCafeConnectFailureSchema.parse({
			message: "GitCafe connection authorization refused",
			code,
			providerStatus,
		}),
	);
}

async function authorize(ctx: GenericEndpointContext, db: Db, orgId: string) {
	const current = await getAuthoritativeSessionFromCtx(ctx);
	if (
		!current ||
		current.session.impersonatedBy ||
		current.user.banned ||
		!("accessStatus" in current.user) ||
		current.user.accessStatus !== "approved"
	) {
		return refused();
	}
	const permissions = await memberPermissions(db, {
		orgId,
		userId: current.user.id,
	});
	if (!permissions?.includes("connections:manage")) return refused();
	return current;
}

function sameOwner(
	flow: GitCafeConnectFlow,
	current: Awaited<ReturnType<typeof authorize>>,
) {
	if (
		flow.userId !== current.user.id ||
		flow.sessionId !== current.session.id ||
		flow.expiresAt <= Date.now()
	)
		refused();
}

/** The grant delegates external authority; it never logs in or links its subject. */
export function gitCafeConnect(input: GitCafeOidcClient & { db: Db }) {
	const { clientId } = gitCafeOidcClientSchema.parse({
		clientId: input.clientId,
	});
	return {
		id: "tripwire-gitcafe-connect",
		endpoints: {
			gitCafeConnectStart: createAuthEndpoint(
				"/gitcafe/connect",
				{
					method: "POST",
					body: gitCafeConnectRequestSchema,
					metadata: { noStore: true },
					requireHeaders: true,
				},
				async (ctx) => {
					/** Require an explicit same-origin request even when invoked through auth.api. */
					if (
						ctx.headers?.get("origin") !== new URL(ctx.context.baseURL).origin
					)
						refused();
					const current = await authorize(ctx, input.db, ctx.body.orgId);
					const flow = gitCafeConnectFlowSchema.parse({
						...ctx.body,
						purpose: "gitcafe-connect",
						forge: "gitcafe",
						userId: current.user.id,
						sessionId: current.session.id,
						nonce: generateRandomString(32),
						expiresAt: Date.now() + LIFETIME_MS,
					});
					await addOAuthServerContext({ gitCafeConnect: flow });
					const { state, codeVerifier } = await generateState(ctx, {
						idTokenNonce: flow.nonce,
					});
					const expiresAt = new Date(flow.expiresAt);
					await ctx.context.internalAdapter.createVerificationValue({
						identifier: FLOW_PREFIX + state,
						value: JSON.stringify(flow),
						expiresAt: new Date(Date.now() + 10 * 60 * 1000),
					});
					await ctx.context.internalAdapter.createVerificationValue({
						identifier: NONCE_PREFIX + flow.nonce,
						value: JSON.stringify(flow),
						expiresAt,
					});
					const url = await createAuthorizationURL({
						id: "gitcafe",
						options: { clientId },
						authorizationEndpoint: `${GITCAFE_ISSUER}/api/oauth/authorize`,
						redirectURI: `${ctx.context.baseURL}/callback/gitcafe`,
						state,
						codeVerifier,
						nonce: flow.nonce,
						scopes: [...GITCAFE_CONNECT_SCOPES],
						additionalParams: { resource: GITCAFE_API_RESOURCE },
					});
					return ctx.json({ url: url.toString() });
				},
			),
			/** Pathless endpoints cannot be reached by the HTTP router. */
			consumeGitCafeConnectProof: createAuthEndpoint.serverOnly(
				{
					method: "POST",
					body: gitCafeConnectProofReadSchema,
					metadata: { noStore: true },
				},
				async (ctx) => {
					if (ctx.request) refused();
					const current = await authorize(ctx, input.db, ctx.body.orgId);
					const identifier = PROOF_PREFIX + ctx.body.proofHandle;
					const record =
						await ctx.context.internalAdapter.findVerificationValue(identifier);
					if (!record) return refused();
					const key = createHmac("sha256", ctx.context.secret)
						.update(PROOF_PREFIX)
						.digest("hex");
					const proof = gitCafeConnectProofSchema.parse(
						JSON.parse(await symmetricDecrypt({ key, data: record.value })),
					);
					sameOwner(proof, current);
					if (
						proof.orgId !== ctx.body.orgId ||
						proof.intendedInstallationId !== ctx.body.intendedInstallationId ||
						proof.tokenExpiresAt <= Date.now()
					)
						refused();
					const consumed =
						await ctx.context.internalAdapter.consumeVerificationValue(
							identifier,
						);
					if (!consumed || consumed.value !== record.value) return refused();
					return proof;
				},
			),
		},
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === "/callback/:id",
					handler: createAuthMiddleware(async (ctx) => {
						const callback = gitCafeConnectCallbackSchema.safeParse(
							ctx.method === "POST" ? { ...ctx.body, ...ctx.query } : ctx.query,
						);
						if (!callback.success) return refused();
						const { state } = callback.data;
						if (!state) return;
						const marker =
							await ctx.context.internalAdapter.findVerificationValue(
								FLOW_PREFIX + state,
							);
						/** Classification reads persisted metadata without consuming ordinary sign-in state. */
						const saved =
							await ctx.context.internalAdapter.findVerificationValue(
								`auth-state:${state}`,
							);
						let connectMetadata = false;
						if (saved) {
							const metadata = gitCafeConnectStoredStateSchema.safeParse(
								JSON.parse(saved.value),
							);
							if (!metadata.success) return refused();
							connectMetadata = Boolean(
								metadata.data.serverContext?.gitCafeConnect,
							);
						}
						if (!marker && !connectMetadata) return;
						ctx.setHeader("cache-control", "no-store");
						ctx.setHeader("pragma", "no-cache");
						ctx.setHeader("referrer-policy", "no-referrer");
						if (ctx.params?.id !== "gitcafe") refused();
						let failureCode: GitCafeConnectFailureCode =
							"GITCAFE_CONNECT_STATE";
						let providerStatus: number | undefined;
						try {
							const parsedState = await parseState(ctx);
							const flow = gitCafeConnectFlowSchema.parse(
								(await getOAuthState())?.serverContext?.gitCafeConnect,
							);
							if (
								!marker ||
								marker.value !== JSON.stringify(flow) ||
								parsedState.idTokenNonce !== flow.nonce
							)
								refused();
							failureCode = "GITCAFE_CONNECT_AUTHORITY";
							const current = await authorize(ctx, input.db, flow.orgId);
							sameOwner(flow, current);
							const query = callback.data;
							if (query.iss !== undefined && query.iss !== GITCAFE_ISSUER)
								refused();
							const nonce =
								await ctx.context.internalAdapter.consumeVerificationValue(
									NONCE_PREFIX + flow.nonce,
								);
							if (!nonce || nonce.value !== marker.value) refused();
							if (query.error) {
								const continuation = new URL(
									"/onboarding/setup",
									ctx.context.baseURL,
								);
								continuation.searchParams.set("forge", "gitcafe");
								continuation.searchParams.set(
									"installation_id",
									flow.intendedInstallationId,
								);
								continuation.searchParams.set("org", flow.orgId);
								continuation.searchParams.set("connect_error", "refused");
								return new Response(null, {
									status: 303,
									headers: {
										location: continuation.toString(),
										"cache-control": "no-store",
										pragma: "no-cache",
										"referrer-policy": "no-referrer",
									},
								});
							}
							if (!query.code) refused();
							failureCode = "GITCAFE_CONNECT_TOKEN_EXCHANGE";
							const tokens = await validateAuthorizationCode({
								code: query.code,
								codeVerifier: parsedState.codeVerifier,
								redirectURI: `${ctx.context.baseURL}/callback/gitcafe`,
								options: { clientId },
								tokenEndpoint: `${GITCAFE_ISSUER}/api/oauth/token`,
								tokenEndpointAuth: { method: "none" },
								resource: GITCAFE_API_RESOURCE,
							});
							failureCode = "GITCAFE_CONNECT_TOKEN_RESPONSE";
							if (
								!tokens.idToken ||
								!tokens.accessToken ||
								tokens.tokenType?.toLowerCase() !== "bearer" ||
								!tokens.scopes ||
								tokens.scopes.length !== GITCAFE_CONNECT_SCOPES.length ||
								!GITCAFE_CONNECT_SCOPES.every((scope) =>
									tokens.scopes?.includes(scope),
								)
							)
								refused();
							const tokenExpiresAt = tokens.accessTokenExpiresAt?.getTime();
							if (
								!tokenExpiresAt ||
								!Number.isFinite(tokenExpiresAt) ||
								tokenExpiresAt <= Date.now()
							)
								refused();
							failureCode = "GITCAFE_CONNECT_IDENTITY";
							const claims = await verifyGitCafeClaims({
								clientId,
								idToken: tokens.idToken,
								accessToken: tokens.accessToken,
								nonce: flow.nonce,
							});
							if (!claims) return refused();
							const read = async (path: string): Promise<unknown> => {
								providerStatus = undefined;
								const response = await fetch(`${GITCAFE_ISSUER}${path}`, {
									headers: {
										authorization: `Bearer ${tokens.accessToken}`,
										accept: "application/json",
									},
									redirect: "error",
									signal: AbortSignal.timeout(10_000),
								});
								providerStatus = response.status;
								if (!response.ok) return refused();
								return response.json();
							};
							failureCode = "GITCAFE_CONNECT_USERINFO";
							const person = gitCafeConnectUserInfoSchema.parse(
								await read("/api/oauth/userinfo"),
							);
							if (person.sub !== claims.sub) refused();
							failureCode = "GITCAFE_CONNECT_PRINCIPAL";
							const principal = gitCafeConnectPrincipalSchema.parse(
								await read("/api/auth/principal"),
							);
							/** Provider reads can outlive revocation of the local session or org permission. */
							providerStatus = undefined;
							failureCode = "GITCAFE_CONNECT_AUTHORITY";
							sameOwner(flow, await authorize(ctx, input.db, flow.orgId));
							failureCode = "GITCAFE_CONNECT_PROOF";
							const proof = gitCafeConnectProofSchema.parse({
								...flow,
								subject: claims.sub,
								actorId: principal.actorId,
								resource: GITCAFE_API_RESOURCE,
								scopes: [...GITCAFE_CONNECT_SCOPES],
								accessToken: tokens.accessToken,
								tokenExpiresAt,
								expiresAt: Math.min(
									flow.expiresAt,
									Date.now() + LIFETIME_MS,
									tokenExpiresAt,
								),
							});
							const proofHandle = generateRandomString(48);
							const key = createHmac("sha256", ctx.context.secret)
								.update(PROOF_PREFIX)
								.digest("hex");
							await ctx.context.internalAdapter.createVerificationValue({
								identifier: PROOF_PREFIX + proofHandle,
								value: await symmetricEncrypt({
									key,
									data: JSON.stringify(proof),
								}),
								expiresAt: new Date(proof.expiresAt),
							});
							const continuation = new URL(
								"/onboarding/setup",
								ctx.context.baseURL,
							);
							continuation.searchParams.set("forge", "gitcafe");
							continuation.searchParams.set(
								"installation_id",
								flow.intendedInstallationId,
							);
							continuation.searchParams.set("org", flow.orgId);
							continuation.searchParams.set("proofHandle", proofHandle);
							return new Response(null, {
								status: 303,
								headers: {
									location: continuation.toString(),
									"cache-control": "no-store",
									pragma: "no-cache",
									"referrer-policy": "no-referrer",
								},
							});
						} catch {
							return refused(failureCode, providerStatus);
						}
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
