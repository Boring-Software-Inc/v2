import { date, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { repos } from "./repos.ts";

/** Daily per-repo stats for Home (spec §4). Written by the worker rollup job. */
export const rollupsDaily = pgTable(
	"rollups_daily",
	{
		id: text("id").primaryKey(),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id),
		day: date("day").notNull(),
		events: integer("events").notNull().default(0),
		runs: integer("runs").notNull().default(0),
		passed: integer("passed").notNull().default(0),
		blocked: integer("blocked").notNull().default(0),
		sentToReview: integer("sent_to_review").notNull().default(0),
	},
	(t) => [uniqueIndex("rollups_daily_repo_day_unique").on(t.repoId, t.day)],
);
