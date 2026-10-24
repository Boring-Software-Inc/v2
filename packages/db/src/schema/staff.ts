import type {
	FlagOverrideChoice,
	FlagSyncStatus,
	StaffAuditAction,
} from "@tripwire/contracts";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

export const userFlagOverrides = pgTable(
	"user_flag_overrides",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		flagKey: text("flag_key").notNull(),
		value: boolean("value"),
		syncStatus: text("sync_status")
			.$type<FlagSyncStatus>()
			.notNull()
			.default("pending"),
		syncError: text("sync_error"),
		syncAttempts: integer("sync_attempts").notNull().default(0),
		syncedAt: timestamp("synced_at", { withTimezone: true }),
		updatedBy: text("updated_by"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("user_flag_overrides_user_flag_unique").on(t.userId, t.flagKey),
		index("user_flag_overrides_flag_idx").on(t.flagKey),
	],
);

export const userFlagOverrideEvents = pgTable(
	"user_flag_override_events",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		flagKey: text("flag_key").notNull(),
		fromValue: text("from_value").$type<FlagOverrideChoice>().notNull(),
		toValue: text("to_value").$type<FlagOverrideChoice>().notNull(),
		actorId: text("actor_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("user_flag_override_events_user_idx").on(t.userId, t.createdAt),
	],
);

export const staffAuditLog = pgTable(
	"staff_audit_log",
	{
		id: text("id").primaryKey(),
		actorId: text("actor_id").notNull(),
		targetUserId: text("target_user_id"),
		action: text("action").$type<StaffAuditAction>().notNull(),
		detail: jsonb("detail"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("staff_audit_log_target_idx").on(t.targetUserId, t.createdAt),
		index("staff_audit_log_actor_idx").on(t.actorId, t.createdAt),
	],
);
