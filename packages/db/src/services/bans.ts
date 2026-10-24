import { type SQL, sql } from "drizzle-orm";
import { user } from "../schema/auth.ts";

export function isBanInForce(
	row: { banned: boolean; banExpires: Date | null } | undefined,
	now = new Date(),
): boolean {
	if (!row?.banned) {
		return false;
	}
	return row.banExpires === null || row.banExpires.getTime() > now.getTime();
}

export function banNotInForce(now = new Date()): SQL {
	return sql`(${user.banned} = false OR (${user.banExpires} IS NOT NULL AND ${user.banExpires} <= ${now}))`;
}
