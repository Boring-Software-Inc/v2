import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";

export const LAST_SEEN_THROTTLE_MS = 60_000;

export async function touchLastSeen(
	db: Db,
	userId: string,
	now: Date = new Date(),
): Promise<{ touched: boolean }> {
	const updated = await db
		.update(user)
		.set({ lastSeenAt: now })
		.where(
			and(
				eq(user.id, userId),
				or(
					isNull(user.lastSeenAt),
					lt(user.lastSeenAt, new Date(now.getTime() - LAST_SEEN_THROTTLE_MS)),
				),
			),
		)
		.returning({ id: user.id });
	return { touched: updated.length > 0 };
}
