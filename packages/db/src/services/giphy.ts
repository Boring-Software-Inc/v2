import { type GiphyPageRecord, giphyPageSchema } from "@tripwire/contracts";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { giphyBudget, giphyCache, giphyFills } from "../schema/giphy.ts";

export const GIPHY_WINDOW_MS = 60 * 60 * 1000;
const STALE_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export interface GiphyCacheEntry {
	body: GiphyPageRecord;
	expiresAt: Date;
}

export async function readGiphyCache(
	db: Db,
	key: string,
): Promise<GiphyCacheEntry | null> {
	const rows = await db
		.select({ body: giphyCache.body, expiresAt: giphyCache.expiresAt })
		.from(giphyCache)
		.where(eq(giphyCache.key, key))
		.limit(1);
	const row = rows[0];
	if (!row) {
		return null;
	}
	const body = giphyPageSchema.safeParse(row.body);
	return body.success ? { body: body.data, expiresAt: row.expiresAt } : null;
}

export async function writeGiphyCache(
	db: Db,
	key: string,
	page: unknown,
	expiresAt: Date,
	now: Date = new Date(),
): Promise<void> {
	const body = giphyPageSchema.parse(page);
	await db
		.insert(giphyCache)
		.values({ key, body, expiresAt, updatedAt: now })
		.onConflictDoUpdate({
			target: [giphyCache.key],
			set: { body, expiresAt, updatedAt: now },
		});
	await db
		.delete(giphyCache)
		.where(lt(giphyCache.expiresAt, new Date(now.getTime() - STALE_KEEP_MS)));
}

export async function findCachedGiphyPage(
	db: Db,
	gifId: string,
): Promise<GiphyPageRecord | null> {
	const rows = await db
		.select({ body: giphyCache.body })
		.from(giphyCache)
		.where(
			sql`${giphyCache.body} -> 'data' @> ${JSON.stringify([{ id: gifId }])}::jsonb`,
		)
		.limit(1);
	const body = giphyPageSchema.safeParse(rows[0]?.body);
	return body.success ? body.data : null;
}

export async function claimGiphyFill(
	db: Db,
	key: string,
	leaseMs: number,
	now: Date = new Date(),
): Promise<boolean> {
	const until = new Date(now.getTime() + leaseMs);
	const claimed = await db
		.insert(giphyFills)
		.values({ key, until })
		.onConflictDoUpdate({
			target: [giphyFills.key],
			set: { until },
			setWhere: lt(giphyFills.until, now),
		})
		.returning({ key: giphyFills.key });
	return claimed.length > 0;
}

export async function releaseGiphyFill(db: Db, key: string): Promise<void> {
	await db.delete(giphyFills).where(eq(giphyFills.key, key));
}

function windowStartOf(now: Date): Date {
	return new Date(
		Math.floor(now.getTime() / GIPHY_WINDOW_MS) * GIPHY_WINDOW_MS,
	);
}

export async function reserveGiphyCall(
	db: Db,
	scope: string,
	limit: number,
	now: Date = new Date(),
): Promise<boolean> {
	const windowStart = windowStartOf(now);
	const previousStart = new Date(windowStart.getTime() - GIPHY_WINDOW_MS);
	const previous = await db
		.select({ calls: giphyBudget.calls })
		.from(giphyBudget)
		.where(
			and(
				eq(giphyBudget.scope, scope),
				eq(giphyBudget.windowStart, previousStart),
			),
		)
		.limit(1);
	const elapsed = (now.getTime() - windowStart.getTime()) / GIPHY_WINDOW_MS;
	const carried = Math.ceil((previous[0]?.calls ?? 0) * (1 - elapsed));
	if (carried + 1 > limit) {
		return false;
	}
	const reserved = await db
		.insert(giphyBudget)
		.values({ scope, windowStart, calls: 1 })
		.onConflictDoUpdate({
			target: [giphyBudget.scope, giphyBudget.windowStart],
			set: { calls: sql`${giphyBudget.calls} + 1` },
			setWhere: sql`${giphyBudget.calls} + 1 + ${carried} <= ${limit}`,
		})
		.returning({ calls: giphyBudget.calls });
	await db
		.delete(giphyBudget)
		.where(lt(giphyBudget.windowStart, new Date(previousStart.getTime() - 1)));
	return reserved.length > 0;
}
