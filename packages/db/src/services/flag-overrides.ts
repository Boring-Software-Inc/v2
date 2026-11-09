import type { FlagOverrideChoice, FlagSyncStatus } from "@tripwire/contracts";
import {
	type DatabuddyApi,
	generateId,
	getDatabuddyUserOverride,
	getErrorMessage,
	truncate,
	updateDatabuddyUserOverrides,
} from "@tripwire/utils";
import { and, desc, eq, inArray, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import {
	flagOverrideRemovals,
	userFlagOverrideEvents,
	userFlagOverrides,
} from "../schema/staff.ts";
import type { DbLike } from "./access.ts";

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

export type SetFlagOverrideResult =
	| {
			ok: true;
			changed: boolean;
			from: FlagOverrideChoice;
			to: FlagOverrideChoice;
	  }
	| { ok: false; error: string };

export async function setUserFlagOverride(
	db: Db,
	api: Pick<DatabuddyApi, "getFlagByKey" | "updateFlagRules">,
	input: {
		userId: string;
		flagKey: string;
		choice: FlagOverrideChoice;
		actorId: string;
	},
): Promise<SetFlagOverrideResult> {
	return await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`databuddy:${input.flagKey}`}, 0))`,
		);
		const target = await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, input.userId))
			.for("key share");
		if (!target[0]) {
			return { ok: false, error: "This user no longer exists." };
		}
		let from: FlagOverrideChoice;
		try {
			const flag = await api.getFlagByKey(input.flagKey);
			if (!flag || flag.status === "archived") {
				return { ok: false, error: FLAG_MISSING_MESSAGE };
			}
			if (flag.rules === undefined) {
				return {
					ok: false,
					error:
						"Databuddy did not return the flag's rules. No changes were made.",
				};
			}
			from = getDatabuddyUserOverride(flag.rules ?? [], input.userId);
			if (from !== input.choice) {
				const updated = await api.updateFlagRules(
					flag.id,
					updateDatabuddyUserOverrides(flag.rules ?? [], [input]),
				);
				if (
					updated.rules === undefined ||
					getDatabuddyUserOverride(updated.rules ?? [], input.userId) !==
						input.choice
				) {
					return {
						ok: false,
						error:
							"Databuddy did not confirm this user's override. Load the flags again before retrying.",
					};
				}
			}
		} catch (error) {
			return { ok: false, error: truncate(getErrorMessage(error), 300) };
		}
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
		const changed = from !== input.choice;
		const now = new Date();
		const value = storedValue(input.choice);
		if (existing[0]) {
			await tx
				.update(userFlagOverrides)
				.set({
					value,
					syncStatus: "synced",
					syncError: null,
					syncAttempts: 0,
					syncedAt: now,
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
				syncStatus: "synced",
				syncedAt: now,
				updatedBy: input.actorId,
				createdAt: now,
				updatedAt: now,
			});
		}
		if (changed) {
			await tx.insert(userFlagOverrideEvents).values({
				id: generateId(),
				userId: input.userId,
				flagKey: input.flagKey,
				fromValue: from,
				toValue: input.choice,
				actorId: input.actorId,
				createdAt: now,
			});
		}
		return { ok: true, changed, from, to: input.choice };
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

export async function recordFlagOverrideRemovals(
	db: DbLike,
	userId: string,
): Promise<string[]> {
	const rows = await db
		.selectDistinct({ flagKey: userFlagOverrides.flagKey })
		.from(userFlagOverrides)
		.where(eq(userFlagOverrides.userId, userId));
	const flagKeys = rows.map((row) => row.flagKey);
	if (flagKeys.length === 0) {
		return [];
	}
	await db
		.insert(flagOverrideRemovals)
		.values(flagKeys.map((flagKey) => ({ id: generateId(), userId, flagKey })))
		.onConflictDoUpdate({
			target: [flagOverrideRemovals.userId, flagOverrideRemovals.flagKey],
			set: { createdAt: new Date() },
		});
	return flagKeys;
}

export async function listPendingFlagRemovals(
	db: Db,
	olderThan: Date,
): Promise<string[]> {
	const rows = await db
		.selectDistinct({ flagKey: flagOverrideRemovals.flagKey })
		.from(flagOverrideRemovals)
		.where(lt(flagOverrideRemovals.createdAt, olderThan))
		.orderBy(flagOverrideRemovals.flagKey);
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
	return await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`databuddy:${flagKey}`}, 0))`,
		);
		const rows = await tx
			.select({
				id: userFlagOverrides.id,
				userId: userFlagOverrides.userId,
				value: userFlagOverrides.value,
				syncStatus: userFlagOverrides.syncStatus,
				updatedAt: sql<string>`${userFlagOverrides.updatedAt}::text`,
			})
			.from(userFlagOverrides)
			.where(eq(userFlagOverrides.flagKey, flagKey));
		const unsynced = rows.filter((row) => row.syncStatus !== "synced");
		const removals = await tx
			.select({
				id: flagOverrideRemovals.id,
				userId: flagOverrideRemovals.userId,
			})
			.from(flagOverrideRemovals)
			.where(eq(flagOverrideRemovals.flagKey, flagKey));
		const clearRemovals = async (): Promise<void> => {
			if (removals.length === 0) {
				return;
			}
			await tx.delete(flagOverrideRemovals).where(
				inArray(
					flagOverrideRemovals.id,
					removals.map((row) => row.id),
				),
			);
		};

		const settle = async (set: {
			syncStatus: FlagSyncStatus;
			syncError: string | null;
			syncAttempts: number | SQL;
			syncedAt?: Date;
		}): Promise<void> => {
			for (const row of unsynced) {
				await tx
					.update(userFlagOverrides)
					.set(set)
					.where(
						and(
							eq(userFlagOverrides.id, row.id),
							sql`${userFlagOverrides.updatedAt} = ${row.updatedAt}::timestamptz`,
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
				await clearRemovals();
				return { status: "missing" };
			}
			if (flag.rules === undefined) {
				return {
					status: "failed",
					error: "Databuddy did not return the flag's rules.",
				};
			}
			let rules = flag.rules ?? [];
			if (removals.length > 0) {
				const cleaned = updateDatabuddyUserOverrides(
					rules,
					removals.map((row) => ({ userId: row.userId, choice: "default" })),
				);
				if (JSON.stringify(cleaned) !== JSON.stringify(rules)) {
					const updated = await api.updateFlagRules(flag.id, cleaned);
					rules = updated.rules ?? [];
					if (
						updated.rules === undefined ||
						removals.some(
							(row) =>
								getDatabuddyUserOverride(rules, row.userId) !== "default",
						)
					) {
						return {
							status: "failed",
							error:
								"Databuddy did not confirm removal of the deleted user's override.",
						};
					}
				}
			}
			let on = 0;
			let off = 0;
			for (const row of rows) {
				const choice = getDatabuddyUserOverride(rules, row.userId);
				if (choice === "on") on++;
				if (choice === "off") off++;
				await tx
					.update(userFlagOverrides)
					.set({
						value: storedValue(choice),
						syncStatus: "synced",
						syncError: null,
						syncAttempts: 0,
						syncedAt: new Date(),
					})
					.where(
						and(
							eq(userFlagOverrides.id, row.id),
							sql`${userFlagOverrides.updatedAt} = ${row.updatedAt}::timestamptz`,
						),
					);
			}
			await clearRemovals();
			return { status: "synced", rows: rows.length, on, off };
		} catch (error) {
			const message = truncate(getErrorMessage(error), 300);
			await settle({
				syncStatus: "failed",
				syncError: message,
				syncAttempts: sql`${userFlagOverrides.syncAttempts} + 1`,
			});
			return { status: "failed", error: message };
		}
	});
}
