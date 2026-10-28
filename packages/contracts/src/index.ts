/**
 * @tripwire/contracts — the shared language.
 *
 * Zod schemas + inferred types, extracted from the redesign demo's mock data.
 * The demo's shapes are the contract; the backend's job is to satisfy them.
 * No functions, no I/O, no deps except zod.
 *
 * Files follow the spec §4 ontology (runs, rules, contributor, repo, insights,
 * moderation). The remaining §4 contracts (events, review, workflow, check)
 * land with the build steps that produce their shapes — see DECISIONS.md.
 */

export * from "./access.ts";
export * from "./action-words.ts";
export * from "./activity.ts";
export * from "./agent-access.ts";
export * from "./agent-work.ts";
export * from "./ai-provider.ts";
export * from "./check.ts";
export * from "./comment-render.ts";
export * from "./contributor.ts";
export * from "./custom-rules.ts";
export * from "./custom-rules-display.ts";
export * from "./economics.ts";
export * from "./events.ts";
export * from "./forge-connection.ts";
export * from "./forges.ts";
export * from "./giphy.ts";
export {
	type GitCafePublicBlob,
	type GitCafePublicProfile,
	type GitCafePublicPull,
	type GitCafePublicRepository,
	gitCafePublicBlobSchema,
	gitCafePublicProfileSchema,
	gitCafePublicPullSchema,
	gitCafePublicRepositorySchema,
} from "./gitcafe.ts";
export {
	type GitCafeCheckConclusion,
	type GitCafeCheckReportInput,
	type GitCafeCheckReportResponse,
	type GitCafeCheckWrite,
	type GitCafeReportedCheck,
	gitCafeCheckConclusionSchema,
	gitCafeCheckReportInputSchema,
	gitCafeCheckReportResponseSchema,
	gitCafeCheckWriteSchema,
	gitCafeReportedCheckSchema,
} from "./gitcafe-check.ts";
export * from "./gitcafe-connect.ts";
export {
	GITCAFE_ISSUER,
	type GitCafeAccountBinding,
	type GitCafeAuthorizationResponse,
	type GitCafeIdentity,
	type GitCafeOidcClaims,
	type GitCafeOidcClient,
	gitCafeAccountBindingSchema,
	gitCafeAuthorizationResponseSchema,
	gitCafeIdentitySchema,
	gitCafeOidcClaimsSchema,
	gitCafeOidcClientSchema,
} from "./gitcafe-identity.ts";
export {
	type GitCafeConnectionRepositories,
	type GitCafeConnectionRepository,
	type GitCafeConnectionRepositoryPage,
	type GitCafeInstallation,
	type GitCafeInstallationToken,
	type GitCafeOrganizationMembers,
	type GitCafePermission,
	gitCafeConnectionRepositoriesSchema,
	gitCafeConnectionRepositoryPageSchema,
	gitCafeConnectionRepositorySchema,
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
	gitCafeOrganizationMembersSchema,
	gitCafePermissionSchema,
} from "./gitcafe-installation.ts";
export {
	type GitCafeReadBlob,
	type GitCafeReadBoundary,
	type GitCafeReadChange,
	type GitCafeReadChanges,
	type GitCafeReadCollaborators,
	type GitCafeReadCommits,
	type GitCafeReadDiffFile,
	type GitCafeReadProfile,
	type GitCafeReadPull,
	type GitCafeReadPullPage,
	gitCafeReadBlobSchema,
	gitCafeReadChangeSchema,
	gitCafeReadChangesSchema,
	gitCafeReadCollaboratorsSchema,
	gitCafeReadCommitsSchema,
	gitCafeReadDiffFileSchema,
	gitCafeReadProfileSchema,
	gitCafeReadPullPageSchema,
	gitCafeReadPullSchema,
} from "./gitcafe-read.ts";
export * from "./gitcafe-receipt.ts";
export {
	type DigestHistory,
	type DigestHistoryInput,
	type DigestHistoryWindow,
	type DigestRepo,
	digestHistoryInputSchema,
	digestHistorySchema,
	digestHistoryWindowSchema,
	digestRepoSchema,
	type HomeDigest,
	type HomeDigestInput,
	homeDigestInputSchema,
	homeDigestSchema,
} from "./home-digest.ts";
export * from "./insights.ts";
export * from "./install-status.ts";
export * from "./issue-copy.ts";
export * from "./moderation.ts";
export * from "./org.ts";
export * from "./org-roles.ts";
export * from "./redact.ts";
export * from "./redaction.ts";
export * from "./repo.ts";
export * from "./repo-content.ts";
export * from "./rerun-job.ts";
export * from "./response.ts";
export * from "./review.ts";
export * from "./rule-exception.ts";
export * from "./rule-execution.ts";
export * from "./rule-packs.ts";
export * from "./rule-replay.ts";
export * from "./rules.ts";
export * from "./run-outcome.ts";
export * from "./run-result.ts";
export * from "./run-steps.ts";
export * from "./runs.ts";
export * from "./setup.ts";
export * from "./staff-user.ts";
export * from "./verdict-join.ts";
export * from "./webhook-payload.ts";
export * from "./workflow.ts";
export * from "./workflow-authoring.ts";
export * from "./workflow-authoring-catalog.ts";
export * from "./workflow-canvas.ts";
export * from "./workflow-codegen.ts";
export * from "./workflow-compile.ts";
export * from "./workflow-connections.ts";
export * from "./workflow-cron.ts";
export * from "./workflow-diff.ts";
export * from "./workflow-keys.ts";
export * from "./workflow-layout.ts";
export * from "./workflow-lint.ts";
export * from "./workflow-push.ts";
export * from "./workflow-schedule.ts";
export * from "./workflow-schedule-sentence.ts";
export * from "./workflow-schedule-text.ts";
export * from "./workflow-templates.ts";
export * from "./workflow-validate.ts";
