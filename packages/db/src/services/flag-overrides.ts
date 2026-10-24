import {
	type FlagOverrideChoice,
	type FlagSyncStatus,
	mergeTripwireRules,
} from "@tripwire/contracts";
import {
	type DatabuddyApi,
	generateId,
	getErrorMessage,
	truncate,
} from "@tripwire/utils";
import { and, desc, eq, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import { userFlagOverrideEvents, userFlagOverrides } from "../schema/staff.ts";

export interface UserFlagOverride {
	flagKey: string;
	choice: FlagOverrideChoice;
	syncStatus: FlagSyncStatus;
	syncError: string | null;
	syncedAt: Date | null;
	updatedAt: Date;
}

export interface FlagOverrideHistoryEntry {
	id: string;
	flagKey: string;
	from: FlagOverrideChoice;
	to: FlagOverrideChoice;
	actorId: string | null;
	actorName: string | null;
	createdAt: Date;
}

export function choiceOf(value: boolean | null): FlagOverrideChoice {
	if (value === null) {
		return "default";
	}
	return value ? "on" : "off";
}

function storedValue(choice: FlagOverrideChoice): boolean | null {
	if (choice === "default") {
		return null;
	}
	return choice === "on";
}

export async function listUserFlagOverrides(
	db: Db,
	userId: string,
): Promise<UserFlagOverride[]> {
	const rows = await db
		.select()
		.from(userFlagOverrides)
		.where(eq(userFlagOverrides.userId, userId))
		.orderBy(userFlagOverrides.flagKey);
	return rows.map((row) => ({
		flagKey: row.flagKey,
		choice: choiceOf(row.value),
		syncStatus: row.syncStatus,
		syncError: row.syncError,
		syncedAt: row.syncedAt,
		updatedAt: row.updatedAt,
	}));
}

export async function listFlagOverrideHistory(
	db: Db,
	userId: string,
	limit = 20,
): Promise<FlagOverrideHistoryEntry[]> {
	const rows = await db
		.select({
			id: userFlagOverrideEvents.id,
			flagKey: userFlagOverrideEvents.flagKey,
			from: userFlagOverrideEvents.fromValue,
			to: userFlagOverrideEvents.toValue,
			actorId: userFlagOverrideEvents.actorId,
			actorName: user.name,
			createdAt: userFlagOverrideEvents.createdAt,
		})
		.from(userFlagOverrideEvents)
		.leftJoin(user, eq(user.id, userFlagOverrideEvents.actorId))
		.where(eq(userFlagOverrideEvents.userId, userId))
		.orderBy(
			desc(userFlagOverrideEvents.createdAt),
			desc(userFlagOverrideEvents.id),
		)
		.limit(Math.min(Math.max(1, limit), 100));
	return rows;
}

export interface SetFlagOverrideResult {
	changed: boolean;
	from: FlagOverrideChoice;
	to: FlagOverrideChoice;
}

export async function setUserFlagOverride(
	db: Db,
	input: {
		userId: string;
		flagKey: string;
		choice: FlagOverrideChoice;
		actorId: string;
	},
): Promise<SetFlagOverrideResult> {
	return await db.transaction(async (tx) => {
		const existing = await tx
			.select({ id: userFlagOverrides.id, value: userFlagOverrides.value })
			.from(userFlagOverrides)
			.where(
				and(
					eq(userFlagOverrides.userId, input.userId),
					eq(userFlagOverrides.flagKey, input.flagKey),
				),
			)
			.for("update");
		const from = choiceOf(existing[0]?.value ?? null);
		if (from === input.choice) {
			return { changed: false, from, to: input.choice };
		}
		const now = new Date();
		const value = storedValue(input.choice);
		if (existing[0]) {
			await tx
				.update(userFlagOverrides)
				.set({
					value,
					syncStatus: "pending",
					syncError: null,
					updatedBy: input.actorId,
					updatedAt: now,
				})
				.where(eq(userFlagOverrides.id, existing[0].id));
		} else {
			await tx.insert(userFlagOverrides).values({
				id: generateId(),
				userId: input.userId,
				flagKey: input.flagKey,
				value,
				syncStatus: "pending",
				updatedBy: input.actorId,
				createdAt: now,
				updatedAt: now,
			});
		}
		await tx.insert(userFlagOverrideEvents).values({
			id: generateId(),
			userId: input.userId,
			flagKey: input.flagKey,
			fromValue: from,
			toValue: input.choice,
			actorId: input.actorId,
			createdAt: now,
		});
		return { changed: true, from, to: input.choice };
	});
}

export async function markFlagOverridePending(
	db: Db,
	input: { userId: string; flagKey: string },
): Promise<boolean> {
	const rows = await db
		.update(userFlagOverrides)
		.set({ syncStatus: "pending", syncError: null })
		.where(
			and(
				eq(userFlagOverrides.userId, input.userId),
				eq(userFlagOverrides.flagKey, input.flagKey),
			),
		)
		.returning({ id: userFlagOverrides.id });
	return rows.length > 0;
}

export async function listActiveOverrideFlagKeys(
	db: Db,
	userId: string,
): Promise<string[]> {
	const rows = await db
		.selectDistinct({ flagKey: userFlagOverrides.flagKey })
		.from(userFlagOverrides)
		.where(
			and(
				eq(userFlagOverrides.userId, userId),
				isNotNull(userFlagOverrides.value),
			),
		);
	return rows.map((row) => row.flagKey);
}

export async function markFlagNotConnected(
	db: Db,
	flagKey: string,
	message: string,
): Promise<void> {
	await db
		.update(userFlagOverrides)
		.set({ syncStatus: "failed", syncError: message })
		.where(
			and(
				eq(userFlagOverrides.flagKey, flagKey),
				inArray(userFlagOverrides.syncStatus, ["pending", "failed"]),
			),
		);
}

export type SyncFlagResult =
	| { status: "synced"; rows: number; on: number; off: number }
	| { status: "missing" }
	| { status: "failed"; error: string };

export const FLAG_MISSING_MESSAGE = "This flag is not in Databuddy.";

export async function syncFlagOverrides(
	db: Db,
	api: Pick<DatabuddyApi, "getFlagByKey" | "updateFlagRules">,
	flagKey: string,
): Promise<SyncFlagResult> {
	const rows = await db
		.select({
			id: userFlagOverrides.id,
			userId: userFlagOverrides.userId,
			value: userFlagOverrides.value,
			syncStatus: userFlagOverrides.syncStatus,
			updatedAt: userFlagOverrides.updatedAt,
		})
		.from(userFlagOverrides)
		.where(eq(userFlagOverrides.flagKey, flagKey));
	const on = rows.filter((row) => row.value === true).map((row) => row.userId);
	const off = rows
		.filter((row) => row.value === false)
		.map((row) => row.userId);
	const unsynced = rows.filter((row) => row.syncStatus !== "synced");

	const settle = async (set: {
		syncStatus: FlagSyncStatus;
		syncError: string | null;
		syncAttempts: number | SQL;
		syncedAt?: Date;
	}): Promise<void> => {
		for (const row of unsynced) {
			await db
				.update(userFlagOverrides)
				.set(set)
				.where(
					and(
						eq(userFlagOverrides.id, row.id),
						eq(userFlagOverrides.updatedAt, row.updatedAt),
					),
				);
		}
	};

	try {
		const flag = await api.getFlagByKey(flagKey);
		if (!flag) {
			await settle({
				syncStatus: "failed",
				syncError: FLAG_MISSING_MESSAGE,
				syncAttempts: sql`${userFlagOverrides.syncAttempts} + 1`,
			});
			return { status: "missing" };
		}
		const rules = mergeTripwireRules(flag.rules ?? [], { on, off });
		await api.updateFlagRules(flag.id, rules);
		await settle({
			syncStatus: "synced",
			syncError: null,
			syncAttempts: 0,
			syncedAt: new Date(),
		});
		return {
			status: "synced",
			rows: rows.length,
			on: on.length,
			off: off.length,
		};
	} catch (error) {
		const message = truncate(getErrorMessage(error), 300);
		await settle({
			syncStatus: "failed",
			syncError: message,
			syncAttempts: sql`${userFlagOverrides.syncAttempts} + 1`,
		});
		return { status: "failed", error: message };
	}
}
