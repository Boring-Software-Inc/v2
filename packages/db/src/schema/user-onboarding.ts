import type { OnboardingStatus, OnboardingStep } from "@tripwire/contracts";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { organization } from "./organizations.ts";
import { repos } from "./repos.ts";

/**
 * One row per user: where they are in first-run onboarding and what they
 * answered. A missing row means onboarding has not started; `completed` and
 * `skipped` both clear the requirement.
 */
export const userOnboarding = pgTable(
	"user_onboarding",
	{
		userId: text("user_id")
			.primaryKey()
			.references(() => user.id, { onDelete: "cascade" }),
		orgId: text("org_id").references(() => organization.id, {
			onDelete: "set null",
		}),
		repoId: text("repo_id").references(() => repos.id, {
			onDelete: "set null",
		}),
		status: text("status")
			.$type<OnboardingStatus>()
			.notNull()
			.default("in_progress"),
		step: text("step").$type<OnboardingStep>().notNull().default("welcome"),
		/** `onboardingAnswersSchema`, validated on write. */
		answers: jsonb("answers").notNull().default({}),
		startedAt: timestamp("started_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		skippedAt: timestamp("skipped_at", { withTimezone: true }),
	},
	(t) => [index("user_onboarding_status_idx").on(t.status)],
);
