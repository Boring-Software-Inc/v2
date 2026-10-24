import {
	LIVE_CHANNEL,
	type LiveNotification,
	liveNotificationSchema,
} from "@tripwire/contracts";
import { sql } from "drizzle-orm";
import type { Db } from "../client.ts";

export async function notifyLive(
	db: Pick<Db, "execute">,
	notification: LiveNotification,
): Promise<void> {
	const payload = JSON.stringify(liveNotificationSchema.parse(notification));
	await db.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${payload})`);
}
