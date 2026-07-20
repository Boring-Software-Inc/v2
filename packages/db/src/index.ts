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
	PROCESS_EVENT_QUEUE,
	type ProcessEventJob,
	RESUME_RUN_QUEUE,
	type ResumeRunJob,
} from "./queue.ts";
export * from "./schema/index.ts";
export {
	DEMO_EMAIL_DOMAIN,
	DEMO_OWNER,
	ensureDemoRepo,
	resetDemoData,
	resetRepoData,
	type SeedRunOptions,
	seedPublicRun,
	seedRun,
	seedStory,
} from "./seed.ts";
export * as accessServices from "./services/access.ts";
export * as eventServices from "./services/events.ts";
export * as insightServices from "./services/insights.ts";
export * as moderationServices from "./services/moderation.ts";
export type { RepoLite, SwitcherRepo } from "./services/onboarding.ts";
export type {
	InviteLinkView,
	OrgCascade,
	OrgSummary,
	OrgWithRole,
	RedeemResult,
} from "./services/organizations.ts";
export * as orgServices from "./services/organizations.ts";
export * as repoServices from "./services/repos.ts";
export * as runServices from "./services/runs.ts";
export type {
	StaffOrgList,
	StaffOrgMemberRow,
	StaffOrgRow,
	StaffOverview,
	StaffUserList,
	StaffUserRow,
} from "./services/staff.ts";
export * as staffServices from "./services/staff.ts";
export type {
	SetEnabledResult,
	WorkflowListItem,
	WorkflowRow,
} from "./services/workflows.ts";
export * as workflowServices from "./services/workflows.ts";
export { createTestDatabase, type TestDatabase } from "./testing.ts";
