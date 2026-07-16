/**
 * §11 org-migration runner: DDL first (drizzle migrations), then the
 * idempotent data backfill. Rehearsable — run against a copy, re-run at will.
 *
 *   bun run scripts/migrate-orgs.ts
 *
 * Exits non-zero if the end-state verification fails (a repo whose
 * installation is claimed ended up with NULL org_id — must be zero).
 */
import { applyMigrations, backfillOrgs, createDb } from "@tripwire/db";

const { db, pool } = createDb();
await applyMigrations(db);
const report = await backfillOrgs(db);
console.log("org backfill report:", JSON.stringify(report, null, 2));
await pool.end();

if (report.claimedButNullRepos > 0) {
	console.error(
		`VERIFICATION FAILED: ${report.claimedButNullRepos} repos have a claimed installation but NULL org_id`,
	);
	process.exit(1);
}
console.log(
	`ok — ${report.unclaimedRepos} repos remain unclaimed (legitimate NULL org_id until claimed)`,
);
