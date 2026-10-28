import type { Forge, ForgeAccountType } from "@tripwire/contracts";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Verified account metadata survives recovery before claiming; this table never grants installation ownership or access. */
export const installationAccounts = pgTable(
	"installation_accounts",
	{
		id: text("id").primaryKey(),
		forge: text("forge").$type<Forge>().notNull(),
		installationId: text("installation_id").notNull(),
		accountLogin: text("account_login").notNull(),
		accountType: text("account_type").$type<ForgeAccountType>().notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("installation_accounts_forge_installation_unique").on(
			table.forge,
			table.installationId,
		),
	],
);
