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
	REFRESH_SURFACES_QUEUE,
	RERUN_COOLDOWN_SECONDS,
	RERUN_QUEUE,
	RESUME_RUN_QUEUE,
	type RefreshSurfacesJob,
	type RerunChangeRequestJob,
	type ResumeRunJob,
	SYNC_REPO_REVIEWERS_QUEUE,
	type SyncRepoReviewersJob,
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
	type DemoWorkflowMode,
	LIVE_WORKFLOW_NAME,
	liveWorkflowDefinition,
	seedDemoWorkflows,
	seedUnclaimedInstall,
} from "./seed-scenarios.ts";
export * as accessServices from "./services/access.ts";
export * as accountServices from "./services/accounts.ts";
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
export * as insightServices from "./services/insights.ts";
export * as moderationServices from "./services/moderation.ts";
export type { RepoLite, SwitcherRepo } from "./services/onboarding.ts";
export type {
	ApprovedInstallRequest,
	ClaimableInstallation,
	InstallPreview,
	InviteLinkView,
	OrgCascade,
	OrgSummary,
	OrgWithRole,
	RedeemResult,
} from "./services/organizations.ts";
export * as orgServices from "./services/organizations.ts";
export * as presenceServices from "./services/presence.ts";
export * as repoServices from "./services/repos.ts";
export type { RedactionUsage } from "./services/responses.ts";
export * as responseServices from "./services/responses.ts";
export type { RepoReviewerList } from "./services/reviewers.ts";
export * as reviewerServices from "./services/reviewers.ts";
export * as runServices from "./services/runs.ts";
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
export type { WorkerDeploymentRow } from "./services/worker-deployments.ts";
export * as workerDeploymentServices from "./services/worker-deployments.ts";
export type {
	SetEnabledResult,
	WorkflowListItem,
	WorkflowRow,
} from "./services/workflows.ts";
export * as workflowServices from "./services/workflows.ts";
export { createTestDatabase, type TestDatabase } from "./testing.ts";
