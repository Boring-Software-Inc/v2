import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { user } from "./schema/auth.ts";
import { ensurePersonalOrg } from "./services/organizations.ts";

/**
 * The §11 backfill, as a function so the idempotency test can run it twice
 * against a real Postgres and assert identical state. Safe to re-run at any
 * point: every step is an upsert or a no-op against already-migrated rows.
 *
 * (Pre-prod simplification: the legacy `user_installations` re-parent step is
 * gone WITH the table — installations are claimed org-first from day one via
 * the setup/claim screens. What remains:)
 *
 *   1. every user gets a personal org (ensurePersonalOrg — skip if exists);
 *   2. repos.org_id backfills from any claimed installation's org;
 *   3. END-STATE VERIFICATION (amendment 3): zero repos whose installation IS
 *      claimed but org_id is NULL. NULL remains legitimate ONLY for repos of
 *      unclaimed GitHub-side installs — those are invisible until the claim
 *      screen binds them, and org-scoped queries are null-safe by construction
 *      (they filter org_id = $org, which NULL never matches).
 *
 * Billing: nothing to re-key — Autumn is not integrated yet. When it lands,
 * customers key to organization.id (see DECISIONS.md).
 */
export interface BackfillReport {
	users: number;
	personalOrgsEnsured: number;
	reposLinked: number;
	/** MUST be 0 — claimed installation but NULL repo org. */
	claimedButNullRepos: number;
	/** Informational: repos on installations nobody has claimed. */
	unclaimedRepos: number;
}

export async function backfillOrgs(db: Db): Promise<BackfillReport> {
	const users = await db.select({ id: user.id, name: user.name }).from(user);
	let personalOrgsEnsured = 0;
	for (const u of users) {
		await ensurePersonalOrg(db, { userId: u.id, name: u.name });
		personalOrgsEnsured++;
	}

	// Fill any repos whose installation is claimed but whose denormalized
	// org pointer is stale/missing — one set-based pass, idempotent.
	const linked = await db.execute(sql`
		UPDATE repos r
		SET org_id = oi.organization_id
		FROM organization_installations oi
		WHERE r.installation_id = oi.installation_id
		  AND r.forge = oi.forge
		  AND r.org_id IS DISTINCT FROM oi.organization_id
	`);

	const [claimedNull] = (
		await db.execute(sql`
			SELECT count(*)::int AS n
			FROM repos r
			JOIN organization_installations oi
			  ON oi.installation_id = r.installation_id AND oi.forge = r.forge
			WHERE r.org_id IS NULL
		`)
	).rows as [{ n: number }];
	const [unclaimed] = (
		await db.execute(sql`
			SELECT count(*)::int AS n
			FROM repos r
			LEFT JOIN organization_installations oi
			  ON oi.installation_id = r.installation_id AND oi.forge = r.forge
			WHERE r.org_id IS NULL AND oi.id IS NULL
		`)
	).rows as [{ n: number }];

	return {
		users: users.length,
		personalOrgsEnsured,
		reposLinked: linked.rowCount ?? 0,
		claimedButNullRepos: claimedNull?.n ?? 0,
		unclaimedRepos: unclaimed?.n ?? 0,
	};
}
