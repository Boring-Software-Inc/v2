import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { giphyBudget, giphyCache } from "../schema/giphy.ts";

export const GIPHY_WINDOW_MS = 60 * 60 * 1000;
const STALE_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export interface GiphyCacheEntry {
	body: unknown;
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
	return rows[0] ?? null;
}

export async function writeGiphyCache(
	db: Db,
	key: string,
	body: unknown,
	expiresAt: Date,
	now: Date = new Date(),
): Promise<void> {
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
): Promise<unknown | null> {
	const rows = await db
		.select({ body: giphyCache.body })
		.from(giphyCache)
		.where(
			sql`${giphyCache.body} -> 'data' @> ${JSON.stringify([{ id: gifId }])}::jsonb`,
		)
		.limit(1);
	return rows[0]?.body ?? null;
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
