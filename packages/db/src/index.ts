/**
 * @tripwire/db — persistence + the service layer.
 *
 * Drizzle schema + services. All three heads (web, api, worker) call these
 * services — logic lives here, never in route handlers or server functions.
 * Every jsonb column has a contracts schema validated ON WRITE (services).
 */

export type { Db } from "./client.ts";
export { createDb, schema } from "./client.ts";
export { applyMigrations } from "./migrate.ts";
export {
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
export * as eventServices from "./services/events.ts";
export * as insightServices from "./services/insights.ts";
export * as moderationServices from "./services/moderation.ts";
export type { OnboardingState, RepoLite } from "./services/onboarding.ts";
export * as onboardingServices from "./services/onboarding.ts";
export * as repoServices from "./services/repos.ts";
export * as runServices from "./services/runs.ts";
export { createTestDatabase, type TestDatabase } from "./testing.ts";
