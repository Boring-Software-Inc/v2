import { createServerFn } from "@tanstack/react-start";
import type { Forge, ForgeConnection } from "@tripwire/contracts";
import {
	type OrganizationForgeConnections,
	organizationConnectionsInputSchema,
	organizationForgeConnectionsSchema,
} from "@tripwire/contracts";
import {
	accessGuardMiddleware,
	notImpersonatingMiddleware,
} from "#/lib/server/gated-server-fn";
import { orgPermissionMiddleware } from "#/lib/server/org-guard";

export const listOrganizationForgeConnections = createServerFn({
	method: "GET",
})
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input) => organizationConnectionsInputSchema.parse(input))
	.handler(async ({ context }): Promise<OrganizationForgeConnections> => {
		const { getDb } = await import("#/lib/server/db");
		const { repositoryConnectionServices } = await import("@tripwire/db");
		return organizationForgeConnectionsSchema.parse(
			await repositoryConnectionServices.listOrganizationForgeConnections(
				getDb().db,
				context.org.id,
			),
		);
	});

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
		const { accountServices } = await import("@tripwire/db");
		return await accountServices.listForgeConnections(getDb().db, userId);
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
	.middleware([accessGuardMiddleware, notImpersonatingMiddleware])
	.inputValidator((data: { forge: Forge; accountId: string }) => data)
	.handler(async ({ data }): Promise<{ removedRepos: number }> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			throw new Error("Your session ended. Sign in again to continue.");
		}
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			throw new Error(
				"Sign-in is turned off on this server, so there is nothing to disconnect.",
			);
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const { getDb } = await import("#/lib/server/db");
		const { repoServices, schema } = await import("@tripwire/db");
		const { and, eq } = await import("drizzle-orm");
		const rows = await getDb()
			.db.select({ id: schema.account.id })
			.from(schema.account)
			.where(
				and(
					eq(schema.account.userId, userId),
					eq(schema.account.providerId, data.forge),
					eq(schema.account.accountId, data.accountId),
				),
			)
			.limit(1);
		const row = rows[0];
		if (!row) {
			throw new Error("This connection is already gone. Reload the page.");
		}
		await auth.api.unlinkAccount({
			body: { accountId: row.id },
			headers: getStartContext().request.headers,
		});

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
