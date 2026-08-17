import { createServerFn } from "@tanstack/react-start";
import { type Forge, forgeSchema } from "@tripwire/contracts";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";

/** One linked forge account, as the connections pane renders it. */
export interface ForgeConnection {
	forge: Forge;
	/** The forge's account id — GitLab's "installation" grouping key. */
	accountId: string;
	/** Repos tripwire currently sees through this connection. */
	repoCount: number;
	/** Repos still unbound to an org, i.e. waiting on the claim screen. */
	unclaimedCount: number;
	/** null ⇒ non-expiring (GitHub OAuth); past ⇒ needs a reconnect. */
	accessTokenExpiresAt: string | null;
	/** False ⇒ the only exit is re-authorization, not a refresh. */
	canRefresh: boolean;
}

/**
 * Every forge the signed-in user has linked, with what tripwire can see through
 * it. Reads better-auth's `account` rows directly rather than
 * `auth.api.listUserAccounts` — the pane needs repo counts and token health
 * joined in, which that endpoint does not return.
 */
export const listForgeConnections = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<ForgeConnection[]> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return [];
		}
		const { getDb } = await import("#/lib/server/db");
		const { sql } = await import("drizzle-orm");
		// Repos join on installation_id, which for OAuth forges IS the account id.
		const result = await getDb().db.execute(sql`
			SELECT a.provider_id AS forge,
			       a.account_id AS "accountId",
			       a.access_token_expires_at AS "accessTokenExpiresAt",
			       (a.refresh_token IS NOT NULL) AS "canRefresh",
			       COALESCE(r.total, 0)::int AS "repoCount",
			       COALESCE(r.unclaimed, 0)::int AS "unclaimedCount"
			FROM account a
			LEFT JOIN (
			  SELECT forge, installation_id,
			         count(*) AS total,
			         count(*) FILTER (WHERE org_id IS NULL) AS unclaimed
			  FROM repos
			  WHERE removed_at IS NULL
			  GROUP BY forge, installation_id
			) r ON r.forge = a.provider_id AND r.installation_id = a.account_id
			WHERE a.user_id = ${userId}
			ORDER BY a.provider_id
		`);
		return (
			(result.rows as Record<string, unknown>[])
				// Non-forge providers (credential rows) share this table — drop anything
				// the catalog doesn't know rather than rendering a markless row.
				.filter((row) => forgeSchema.safeParse(row.forge).success)
				.map((row) => ({
					forge: forgeSchema.parse(row.forge),
					accountId: String(row.accountId),
					repoCount: Number(row.repoCount ?? 0),
					unclaimedCount: Number(row.unclaimedCount ?? 0),
					accessTokenExpiresAt: row.accessTokenExpiresAt
						? new Date(row.accessTokenExpiresAt as string).toISOString()
						: null,
					canRefresh: Boolean(row.canRefresh),
				}))
		);
	});

/**
 * Unlink a forge and stop watching everything that arrived through it.
 *
 * Two halves, both required: better-auth drops the `account` row (the tokens),
 * and the repos it brought in are SOFT-removed (`removed_at`). Dropping only the
 * tokens would leave repos that look watched but can never be read — a gate that
 * silently does nothing is worse than one that's visibly off.
 *
 * Soft, not hard: reconnecting and re-importing brings them back, and run history
 * stays interpretable (§5 — raw payloads are append-only).
 *
 * better-auth refuses to unlink your last credential, so this cannot lock you out.
 */
export const disconnectForge = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((data: { forge: Forge; accountId: string }) => data)
	.handler(async ({ data }): Promise<{ removedRepos: number }> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			throw new Error("session required");
		}
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			throw new Error("auth disabled");
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		await auth.api.unlinkAccount({
			body: { providerId: data.forge, accountId: data.accountId },
			headers: getStartContext().request.headers,
		});

		const { getDb } = await import("#/lib/server/db");
		const { repoServices } = await import("@tripwire/db");
		// `removeInstallation`, not a bare UPDATE — it also drops the
		// `organization_installations` row. That row is a live-ownership pointer:
		// leaving it behind meant a re-import produced repos that were unclaimed
		// (`org_id IS NULL`, so invisible to every org) AND unclaimable (the claim
		// screen excludes any installation that still has one), i.e. permanently
		// orphaned. The GitHub uninstall path already learned this.
		return await repoServices.removeInstallation(
			getDb().db,
			data.forge,
			data.accountId,
		);
	});
