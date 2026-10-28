import { z } from "zod";
import { forgeIdSchema } from "./forges.ts";
import { GITCAFE_ISSUER, gitCafeIdentitySchema } from "./gitcafe-identity.ts";
import { orgSlugSchema } from "./org.ts";

export const GITCAFE_API_RESOURCE = `${GITCAFE_ISSUER}/api`;
export const GITCAFE_CONNECT_SCOPES = [
	"openid",
	"profile",
	"email",
	"repo:metadata:read",
] as const;

export const gitCafeConnectFailureCodeSchema = z.enum([
	"GITCAFE_CONNECT_STATE",
	"GITCAFE_CONNECT_AUTHORITY",
	"GITCAFE_CONNECT_TOKEN_EXCHANGE",
	"GITCAFE_CONNECT_TOKEN_RESPONSE",
	"GITCAFE_CONNECT_IDENTITY",
	"GITCAFE_CONNECT_USERINFO",
	"GITCAFE_CONNECT_PRINCIPAL",
	"GITCAFE_CONNECT_PROOF",
]);
export type GitCafeConnectFailureCode = z.infer<
	typeof gitCafeConnectFailureCodeSchema
>;

export const gitCafeConnectFailureSchema = z.strictObject({
	message: z.literal("GitCafe connection authorization refused"),
	code: gitCafeConnectFailureCodeSchema.optional(),
	providerStatus: z.number().int().min(100).max(599).optional(),
});
export type GitCafeConnectFailure = z.infer<typeof gitCafeConnectFailureSchema>;

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

/** Userinfo revalidates the signed subject with the delegated access token. */
export const gitCafeConnectUserInfoSchema = z.object({
	sub: gitCafeIdentitySchema.shape.subject,
});
export type GitCafeConnectUserInfo = z.infer<
	typeof gitCafeConnectUserInfoSchema
>;

export const gitCafeConnectProofSchema = gitCafeConnectFlowSchema.extend({
	subject: gitCafeIdentitySchema.shape.subject,
	actorId: gitCafeIdentitySchema.shape.subject,
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

export const GITCAFE_CONNECT_QUEUE = "gitcafe-connect";
export const GITCAFE_CONNECTION_MAX_AGE_MS = 300_000;

/** A consumed person proof authorizes one bounded action; credentials never enter the queue. */
export const gitCafeConnectionJobSchema = z
	.strictObject({
		userId: z.string().min(1),
		sessionId: z.string().min(1),
		orgId: z.string().min(1),
		installationId: z
			.string()
			.regex(/^[A-Za-z0-9_-]+$/)
			.max(255),
		subject: gitCafeIdentitySchema.shape.subject,
		actorId: gitCafeIdentitySchema.shape.subject,
		authorizedAt: z.number().int().positive().safe(),
		expiresAt: z.number().int().positive().safe(),
		requestId: z.string().min(1).max(255),
	})
	.refine(
		(job) =>
			job.expiresAt > job.authorizedAt &&
			job.expiresAt - job.authorizedAt <= GITCAFE_CONNECTION_MAX_AGE_MS,
		{ message: "connection authorization must expire within five minutes" },
	);
export type GitCafeConnectionJob = z.infer<typeof gitCafeConnectionJobSchema>;

export const gitCafeConnectionSelectionSchema = z.strictObject({
	org: z.string().min(1),
	installationId: gitCafeConnectionJobSchema.shape.installationId,
});
export type GitCafeConnectionSelection = z.infer<
	typeof gitCafeConnectionSelectionSchema
>;

export const gitCafeConnectionConfirmationSchema =
	gitCafeConnectionSelectionSchema.extend(
		gitCafeConnectProofHandleSchema.shape,
	);
export type GitCafeConnectionConfirmation = z.infer<
	typeof gitCafeConnectionConfirmationSchema
>;

export const gitCafeConnectionStatusInputSchema =
	gitCafeConnectionSelectionSchema.extend({ jobId: z.uuid().optional() });
export type GitCafeConnectionStatusInput = z.infer<
	typeof gitCafeConnectionStatusInputSchema
>;

export const gitCafeConnectionRefusalSchema = z.enum([
	"invalid-job",
	"unauthorized",
	"expired",
	"configuration",
	"authority-unavailable",
	"not-admin",
	"installation-mismatch",
	"repository-mismatch",
	"repository-conflict",
	"ownership-conflict",
	"queue-unavailable",
]);
export type GitCafeConnectionRefusal = z.infer<
	typeof gitCafeConnectionRefusalSchema
>;

export const gitCafeConnectionConfirmationResultSchema = z.discriminatedUnion(
	"ok",
	[
		z.strictObject({
			ok: z.literal(true),
			jobId: gitCafeConnectionStatusInputSchema.shape.jobId.unwrap(),
		}),
		z.strictObject({
			ok: z.literal(false),
			reason: z.union([
				gitCafeConnectionRefusalSchema,
				z.enum(["unavailable", "refused", "retry"]),
			]),
		}),
	],
);
export type GitCafeConnectionConfirmationResult = z.infer<
	typeof gitCafeConnectionConfirmationResultSchema
>;

export const gitCafeConnectionStatusSchema = z.discriminatedUnion("status", [
	z.strictObject({ status: z.literal("pending") }),
	z.strictObject({
		status: z.literal("connected"),
		repoCount: z.number().int().nonnegative(),
	}),
	z.strictObject({
		status: z.literal("refused"),
		reason: gitCafeConnectionRefusalSchema,
	}),
	z.strictObject({ status: z.literal("retry") }),
]);
export type GitCafeConnectionStatus = z.infer<
	typeof gitCafeConnectionStatusSchema
>;

export const gitCafeConnectionStatusRequestSchema = z.strictObject({
	userId: z.string().min(1),
	sessionId: z.string().min(1),
	orgId: z.string().min(1),
	installationId: gitCafeConnectionJobSchema.shape.installationId,
	jobId: z.uuid().optional(),
});
export type GitCafeConnectionStatusRequest = z.infer<
	typeof gitCafeConnectionStatusRequestSchema
>;

export const gitCafeConnectionResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(true),
		repoCount: z.number().int().nonnegative(),
	}),
	z.strictObject({
		ok: z.literal(false),
		reason: gitCafeConnectionRefusalSchema,
	}),
]);
export type GitCafeConnectionResult = z.infer<
	typeof gitCafeConnectionResultSchema
>;

export const gitCafeSetupInputSchema = z.strictObject({
	installationId: z.string().min(1),
	state: z.string().optional(),
	orgId: z.string().min(1).optional(),
});
export type GitCafeSetupInput = z.infer<typeof gitCafeSetupInputSchema>;

export const gitCafeSetupContextSchema = z.strictObject({
	orgs: z.array(
		z.strictObject({
			id: z.string().min(1),
			slug: orgSlugSchema,
			name: z.string().min(1),
		}),
	),
	suggestedOrg: orgSlugSchema.nullable(),
});
export type GitCafeSetupContext = z.infer<typeof gitCafeSetupContextSchema>;

export const setupSearchSchema = z.object({
	installation_id: z
		.union([z.string(), z.number()])
		.transform(String)
		.optional()
		.catch(undefined),
	setup_action: z.string().optional().catch(undefined),
	state: z.string().optional().catch(undefined),
	forge: forgeIdSchema.optional().catch(undefined),
	org: z.string().min(1).optional().catch(undefined),
	proofHandle: gitCafeConnectProofHandleSchema.shape.proofHandle
		.optional()
		.catch(undefined),
	connect_error: z.string().optional().catch(undefined),
	jobId: z.uuid().optional().catch(undefined),
});
export type SetupSearch = z.infer<typeof setupSearchSchema>;
