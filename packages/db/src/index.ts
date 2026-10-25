/**
 * @tripwire/db — persistence + the service layer.
 *
 * Drizzle schema + services. All three heads (web, api, worker) call these
 * services — logic lives here, never in route handlers or server functions.
 * Every jsonb column has a contracts schema validated ON WRITE (services).
 */

export { type BackfillReport, backfillOrgs } from "./backfill-orgs.ts";
export type { Db } from "./client.ts";
export { createDb, createDirectPool, schema } from "./client.ts";
export { applyMigrations } from "./migrate.ts";
export {
	applyPgliteMigrations,
	createPgliteDb,
	type PgliteHandle,
} from "./pglite.ts";
export {
	BACKFILL_REPO_QUEUE,
	type BackfillRepoJob,
	createBoss,
	DEFAULT_RERUN_COOLDOWN_SECONDS,
	getRerunCooldownSeconds,
	PROCESS_EVENT_QUEUE,
	type ProcessEventJob,
	RECOVER_INSTALLATION_QUEUE,
	REFRESH_SURFACES_QUEUE,
	RERUN_COOLDOWN_SECONDS,
	RERUN_QUEUE,
	RESUME_RUN_QUEUE,
	type RecoverInstallationJob,
	type RefreshSurfacesJob,
	type RerunChangeRequestJob,
	type ResumeRunJob,
	RULE_PREVIEW_QUEUE,
	type RulePreviewJob,
	recoverInstallationOptions,
	rulePreviewOptions,
	SYNC_FLAG_OVERRIDES_QUEUE,
	SYNC_REPO_BRANCHES_QUEUE,
	SYNC_REPO_LABELS_QUEUE,
	SYNC_REPO_REVIEWERS_QUEUE,
	type SyncFlagOverridesJob,
	type SyncRepoBranchesJob,
	type SyncRepoLabelsJob,
	type SyncRepoReviewersJob,
	syncFlagOverridesOptions,
	syncRepoBranchesOptions,
	syncRepoLabelsOptions,
	syncRepoReviewersOptions,
} from "./queue.ts";
export * from "./schema/index.ts";
export {
	DEMO_EMAIL_DOMAIN,
	DEMO_OWNER,
	DEMO_TEAM_SLUG,
	ensureDemoRepo,
	resetDemoData,
	resetRepoData,
	type SeedRunOptions,
	seedPublicRun,
	seedRun,
	seedStory,
} from "./seed.ts";
export {
	ensureDemoTeammates,
	ensureTeamOrg,
	seedActivePersonaExtras,
	seedApprovedInstallRequest,
	seedEconomics,
	seedRepoExtras,
	seedRollups,
	seedTeamOrg,
	seedWorkflowCatalog,
} from "./seed-extras.ts";
export {
	BROKEN_WORKFLOW_NAME,
	brokenWorkflowDefinition,
	type DemoRecoveryState,
	type DemoWorkflowMode,
	LIVE_WORKFLOW_NAME,
	liveWorkflowDefinition,
	seedDemoWorkflows,
	seedInstallRecoveryState,
	seedUnclaimedInstall,
} from "./seed-scenarios.ts";
export * as accessServices from "./services/access.ts";
export type {
	AccountMembership,
	DeletedAccount,
	OnRepo,
	OrgInstallation,
	SoleAdminOrg,
} from "./services/account-deletion.ts";
export * as accountDeletionServices from "./services/account-deletion.ts";
export {
	AccountDeletionBlockedError,
	DELETED_ACCOUNT_ACTOR,
} from "./services/account-deletion.ts";
export * as accountServices from "./services/accounts.ts";
export type {
	AgentApplyResult,
	BeginWorkResult,
	DraftDecisionResult,
	DraftSignalResult,
	WorkAgent,
	WorkflowCard,
	WorkflowWorkDetail,
} from "./services/agent-work.ts";
export * as agentWorkServices from "./services/agent-work.ts";
export type { AgentGrant, ConnectedAgent } from "./services/agents.ts";
export * as agentServices from "./services/agents.ts";
export * as aiProviderServices from "./services/ai-provider.ts";
export type {
	CustomRuleView,
	SaveCustomRuleResult,
} from "./services/custom-rules.ts";
export * as customRuleServices from "./services/custom-rules.ts";
export type {
	AiReviewUsageInput,
	BackfillUsageResult,
	CostByOrgRow,
	DailyCostPoint,
	DailyTotals,
	EconomicsDayPoint,
	EconomicsOverview,
	MonthlySummary,
	RailwayBreakdown,
	RailwayServiceBreakdown,
	RollupResult,
	UsageCountersInput,
} from "./services/economics.ts";
export * as economicsServices from "./services/economics.ts";
export * as eventServices from "./services/events.ts";
export * as flagOverrideServices from "./services/flag-overrides.ts";
export {
	FLAG_MISSING_MESSAGE,
	type FlagOverrideHistoryEntry,
	type SetFlagOverrideResult,
	type SyncFlagResult,
	type UserFlagOverride,
} from "./services/flag-overrides.ts";
export * as giphyServices from "./services/giphy.ts";
export * as insightServices from "./services/insights.ts";
export type {
	InstallAccessCheck,
	InstallAccessKey,
} from "./services/installation-access.ts";
export * as installationAccessServices from "./services/installation-access.ts";
export type { RepoLabelList } from "./services/labels.ts";
export * as labelServices from "./services/labels.ts";
export type { LiveViewer } from "./services/live.ts";
export * as liveServices from "./services/live.ts";
export * as moderationServices from "./services/moderation.ts";
export type { RepoLite, SwitcherRepo } from "./services/onboarding.ts";
export type {
	ApprovedInstallRequest,
	ClaimableInstallation,
	InviteLinkView,
	OrgCascade,
	OrgSummary,
	OrgWithRole,
	RedeemResult,
	UnprovenInstallationClaim,
} from "./services/organizations.ts";
export * as orgServices from "./services/organizations.ts";
export * as presenceServices from "./services/presence.ts";
export * as repoServices from "./services/repos.ts";
export type { RedactionUsage } from "./services/responses.ts";
export * as responseServices from "./services/responses.ts";
export type { RepoReviewerList } from "./services/reviewers.ts";
export * as reviewerServices from "./services/reviewers.ts";
export type {
	PreviewChangeRequest,
	PreviewInputs,
	PreviewStep,
	StoredRulePreview,
} from "./services/rule-previews.ts";
export * as rulePreviewServices from "./services/rule-previews.ts";
export type {
	RuleConfigView,
	RulesHeaderStats,
	SaveRuleResult,
} from "./services/rules.ts";
export * as ruleServices from "./services/rules.ts";
export * as runServices from "./services/runs.ts";
export type { DueSchedule } from "./services/schedules.ts";
export * as scheduleServices from "./services/schedules.ts";
export type {
	AgentSetupPromptState,
	SetupNextStep,
	SetupProgressResult,
	SetupStatus,
} from "./services/setup.ts";
export * as setupServices from "./services/setup.ts";
export type {
	StaffInstallationList,
	StaffInstallationRow,
	StaffOrgList,
	StaffOrgMemberRow,
	StaffOrgRow,
	StaffOverview,
	StaffRepoList,
	StaffRepoRow,
	StaffUserList,
	StaffUserRow,
} from "./services/staff.ts";
export * as staffServices from "./services/staff.ts";
export type { StaffAuditEntry } from "./services/staff-audit.ts";
export * as staffAuditServices from "./services/staff-audit.ts";
export type {
	SessionGuardState,
	StaffContributorRun,
	StaffForgeIdentity,
	StaffModerationDecision,
	StaffUserDetail,
	StaffUserSession,
} from "./services/staff-users.ts";
export * as staffUserServices from "./services/staff-users.ts";
export type { WorkerDeploymentRow } from "./services/worker-deployments.ts";
export * as workerDeploymentServices from "./services/worker-deployments.ts";
export type {
	DecideWorkflowPushResult,
	ProposeWorkflowPushResult,
	PushBlock,
	WorkflowPushRecord,
	WorkflowPushReview,
	WorkflowPushReviewEntry,
} from "./services/workflow-pushes.ts";
export * as workflowPushServices from "./services/workflow-pushes.ts";
export type {
	SetEnabledResult,
	WorkflowListItem,
	WorkflowRow,
} from "./services/workflows.ts";
export * as workflowServices from "./services/workflows.ts";
export {
	createTestDatabase,
	type TestDatabase,
	turnOnLegacyRules,
} from "./testing.ts";
