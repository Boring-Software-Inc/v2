import { z } from "zod";
import { GITCAFE_ISSUER, gitCafeIdentitySchema } from "./gitcafe-identity.ts";

export const GITCAFE_API_RESOURCE = `${GITCAFE_ISSUER}/api`;
export const GITCAFE_CONNECT_SCOPES = [
	"openid",
	"profile",
	"email",
	"repo:metadata:read",
] as const;

export const gitCafeConnectRequestSchema = z.strictObject({
	orgId: z.string().min(1),
	intendedInstallationId: z.string().min(1).max(255),
});
export type GitCafeConnectRequest = z.infer<typeof gitCafeConnectRequestSchema>;

export const gitCafeConnectFlowSchema = gitCafeConnectRequestSchema.extend({
	purpose: z.literal("gitcafe-connect"),
	forge: z.literal("gitcafe"),
	userId: z.string().min(1),
	sessionId: z.string().min(1),
	nonce: z.string().min(32),
	expiresAt: z.number().int().positive(),
});
export type GitCafeConnectFlow = z.infer<typeof gitCafeConnectFlowSchema>;

/** Documented OpenAPI projections; genuine person-read evidence is still missing. */
export const gitCafeConnectUserInfoSchema = z.object({
	sub: gitCafeIdentitySchema.shape.subject,
});
export type GitCafeConnectUserInfo = z.infer<
	typeof gitCafeConnectUserInfoSchema
>;

export const gitCafeConnectPrincipalSchema = z.object({
	actorId: z.string().min(1),
	handle: z.string(),
	displayName: z.string().nullable(),
	avatarUrl: z.string().nullable(),
});
export type GitCafeConnectPrincipal = z.infer<
	typeof gitCafeConnectPrincipalSchema
>;

export const gitCafeConnectProofSchema = gitCafeConnectFlowSchema.extend({
	subject: gitCafeIdentitySchema.shape.subject,
	actorId: gitCafeConnectPrincipalSchema.shape.actorId,
	resource: z.literal(GITCAFE_API_RESOURCE),
	scopes: z.tuple([
		z.literal("openid"),
		z.literal("profile"),
		z.literal("email"),
		z.literal("repo:metadata:read"),
	]),
	accessToken: z.string().min(1),
	tokenExpiresAt: z.number().int().positive(),
});
export type GitCafeConnectProof = z.infer<typeof gitCafeConnectProofSchema>;

export const gitCafeConnectProofHandleSchema = z.strictObject({
	proofHandle: z.string().regex(/^[a-zA-Z0-9_-]{48}$/),
});
export type GitCafeConnectProofHandle = z.infer<
	typeof gitCafeConnectProofHandleSchema
>;

export const gitCafeConnectProofReadSchema = gitCafeConnectRequestSchema.extend(
	gitCafeConnectProofHandleSchema.shape,
);
export type GitCafeConnectProofRead = z.infer<
	typeof gitCafeConnectProofReadSchema
>;

/** Storage shape used only to classify Better Auth 1.7.12's persisted OAuth state. */
export const gitCafeConnectStoredStateSchema = z.looseObject({
	serverContext: z
		.looseObject({ gitCafeConnect: gitCafeConnectFlowSchema.optional() })
		.optional(),
});
export type GitCafeConnectStoredState = z.infer<
	typeof gitCafeConnectStoredStateSchema
>;

export const gitCafeConnectCallbackSchema = z.object({
	state: z.string().optional(),
	code: z.string().optional(),
	error: z.string().optional(),
	iss: z.string().optional(),
});
export type GitCafeConnectCallback = z.infer<
	typeof gitCafeConnectCallbackSchema
>;
