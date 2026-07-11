import { createBoss, createDb } from "@tripwire/db";
import type { PgBoss } from "pg-boss";

/**
 * Server-only database access for TanStack server functions. Import this
 * module ONLY inside `createServerFn` handlers (dynamic import) so pg never
 * reaches the client bundle. One pool per web server process.
 */
let instance: ReturnType<typeof createDb> | null = null;
let boss: PgBoss | null = null;

export function getDb() {
	instance ??= createDb();
	return instance;
}

export async function getBoss(): Promise<PgBoss> {
	const existing = boss;
	if (existing) {
		return existing;
	}
	const created = await createBoss();
	boss = created;
	return created;
}
