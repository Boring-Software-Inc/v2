import { z } from "zod";

export const GITCAFE_ISSUER = "https://git.cafe";

export const gitCafeOidcClientSchema = z.strictObject({
	clientId: z.string().trim().min(1),
});
export type GitCafeOidcClient = z.infer<typeof gitCafeOidcClientSchema>;

export const gitCafeAuthorizationResponseSchema = z.object({ url: z.url() });

/** Parsed only after signature and request binding checks in @tripwire/auth. */
export const gitCafeOidcClaimsSchema = z.object({
	iss: z.literal(GITCAFE_ISSUER),
	sub: z.string().min(1).max(255),
	aud: z.string().min(1),
	exp: z.number().int().positive(),
	iat: z.number().int().positive(),
	nonce: z.string().min(1),
	at_hash: z.string().min(1),
	azp: z.string().min(1).optional(),
	preferred_username: z.string().min(1),
	email: z.email(),
	email_verified: z.literal(true),
	name: z.string().optional(),
	picture: z.url().optional(),
});
export type GitCafeOidcClaims = z.infer<typeof gitCafeOidcClaimsSchema>;

export const gitCafeIdentitySchema = z.object({
	issuer: z.literal(GITCAFE_ISSUER),
	subject: z.string().min(1).max(255),
	handle: z.string().min(1),
});
export type GitCafeIdentity = z.infer<typeof gitCafeIdentitySchema>;
