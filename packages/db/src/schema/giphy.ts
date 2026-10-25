import {
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const giphyCache = pgTable(
	"giphy_cache",
	{
		key: text("key").primaryKey(),
		body: jsonb("body").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("giphy_cache_expires_idx").on(t.expiresAt)],
);

export const giphyBudget = pgTable(
	"giphy_budget",
	{
		scope: text("scope").notNull(),
		windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
		calls: integer("calls").notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.scope, t.windowStart] }),
		index("giphy_budget_window_idx").on(t.windowStart),
	],
);
