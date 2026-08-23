import { createServerFn } from "@tanstack/react-start";
import type { Forge } from "@tripwire/contracts";
import type { OrgWithRole, SwitcherRepo } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgAdminMiddleware,
	orgMemberMiddleware,
} from "#/lib/server/org-guard";

export type { SwitcherRepo };

/**
 * Install targeting + org home (§10, org-model). The old user-onboarding
 * flow (pick ONE active repo) is gone — the URL owns scope now. What remains:
 * getting the GitHub App installed FOR AN ORG, verifying the round-trip, and
 * claiming installs that arrived without state. Never auto-attach on a guess.
 */

export interface OrgHomeState {
	hasInstallation: boolean;
	repos: SwitcherRepo[];
}

/** Everything /:org/home needs: install state + repo rows with signal. */
export const getOrgHomeState = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgHomeState> => {
		const org = (context as { org: OrgWithRole }).org;
		const { orgServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const [state, repos] = await Promise.all([
			orgServices.getOrgInstallState(db, org.id),
			orgServices.listOrgSwitcherRepos(db, org.id),
		]);
		return { hasInstallation: state.hasInstallation, repos };
	});

export type InstallUrlState =
	| { status: "ready"; url: string }
	| { status: "not-configured" }
	| { status: "no-session" };

/**
 * The install URL FOR THIS ORG, on the forge asked for. Admin-only: installing
 * changes what the org gates.
 *
 * GitHub round-trips a signed `state` carrying {userId, orgId}, so its Setup
 * callback can name both sides and confirm. open-git does NOT: its
 * `installationConnectUrl` appends `installation_id` and nothing else. That is
 * not a blocker — the same callback already treats a missing state as a CLAIM
 * and shows the org picker (§10, never auto-attach on a guess) — but it is the
 * reason the state is only attached for GitHub.
 */
function installUrlFor(forge: Forge, state: string): InstallUrlState {
	if (forge === "github") {
		const slug = process.env.GITHUB_APP_SLUG;
		return slug
			? {
					status: "ready",
					url: `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`,
				}
			: { status: "not-configured" };
	}
	const owner = process.env.OPEN_GIT_BOT_OWNER;
	const slug = process.env.OPEN_GIT_BOT_SLUG;
	if (!(owner && slug)) {
		return { status: "not-configured" };
	}
	const origin = (process.env.OPEN_GIT_URL ?? "https://open-git.com").replace(
		/\/$/,
		"",
	);
	return {
		status: "ready",
		url: `${origin}/integrations/${owner}/${slug}/install`,
	};
}

export const getOrgInstallUrl = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string; forge?: Forge }) => input)
	.handler(async ({ context, data }): Promise<InstallUrlState> => {
		const org = (context as { org: OrgWithRole }).org;
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return { status: "no-session" };
		}
		const { signInstallState } = await import("#/lib/server/install-state");
		const state = signInstallState({ userId, orgId: org.id });
		return installUrlFor(data.forge ?? "github", state);
	});

export interface InstallPreview {
	installationId: string;
	/** The forge the unclaimed repos live on (from the synced rows). */
	forge: Forge;
	/** Forge account the install/import is on, inferred from synced repos. */
	account: string | null;
	repoCount: number;
	/** The org the signed state targets — null when state is absent/forged
	 * or was initiated by a different user (§10: then it's a CLAIM, not a
	 * confirmation). */
	stateOrg: { id: string; slug: string; name: string } | null;
	/** Whether this installation is already claimed (and by which slug when
	 * the caller can see it). */
	claimedByOrgSlug: string | null;
}

/**
 * What the setup-callback screen shows before anything is claimed: the
 * GitHub side (account + repo count, from repos the webhook already synced)
 * and the Tripwire side (the state's target org, when the state verifies AND
 * belongs to the signed-in caller). Session-gated only — the caller may not
 * be an admin of anything yet; claiming is a separate admin-gated act.
 */
export const getInstallPreview = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { installationId: string; state?: string }) => input)
	.handler(async ({ data }): Promise<InstallPreview> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		const { getDb } = await import("#/lib/server/db");
		const { orgServices, schema } = await import("@tripwire/db");
		const { and, eq, isNull, sql } = await import("drizzle-orm");
		const db = getDb().db;

		const repoRows = await db
			.select({
				owner: schema.repos.owner,
				forge: schema.repos.forge,
				n: sql<number>`count(*)::int`,
			})
			.from(schema.repos)
			.where(
				and(
					eq(schema.repos.installationId, data.installationId),
					isNull(schema.repos.removedAt),
				),
			)
			.groupBy(schema.repos.owner, schema.repos.forge);
		const account = repoRows[0]?.owner ?? null;
		const forge: Forge = repoRows[0]?.forge ?? "github";
		const repoCount = repoRows.reduce((sum, r) => sum + r.n, 0);

		let stateOrg: InstallPreview["stateOrg"] = null;
		if (data.state && userId) {
			const { verifyInstallState } = await import("#/lib/server/install-state");
			const bound = verifyInstallState(data.state);
			if (bound && bound.userId === userId) {
				const orgRows = await db
					.select({
						id: schema.organization.id,
						slug: schema.organization.slug,
						name: schema.organization.name,
					})
					.from(schema.organization)
					.where(eq(schema.organization.id, bound.orgId))
					.limit(1);
				stateOrg = orgRows[0] ?? null;
			}
		}

		const ownerOrgId = await orgServices.getInstallationOrg(db, {
			installationId: data.installationId,
			forge,
		});
		let claimedByOrgSlug: string | null = null;
		if (ownerOrgId) {
			const rows = await db
				.select({ slug: schema.organization.slug })
				.from(schema.organization)
				.where(eq(schema.organization.id, ownerOrgId))
				.limit(1);
			claimedByOrgSlug = rows[0]?.slug ?? null;
		}
		return {
			installationId: data.installationId,
			forge,
			account,
			repoCount,
			stateOrg,
			claimedByOrgSlug,
		};
	});

/**
 * Bind an installation to THIS org — the confirmation screen's confirm and
 * the claim screen's pick both land here. Admin-gated; idempotent; a second
 * org cannot steal a claim ((forge, installationId) unique).
 */
export const claimInstallation = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; installationId: string; forge: Forge }) => input,
	)
	.handler(async ({ data, context }): Promise<{ claimed: boolean }> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices, schema } = await import("@tripwire/db");
		const { and, eq, isNull } = await import("drizzle-orm");
		const db = getDb().db;
		const owner = await db
			.select({ owner: schema.repos.owner })
			.from(schema.repos)
			.where(
				and(
					eq(schema.repos.forge, data.forge),
					eq(schema.repos.installationId, data.installationId),
					isNull(schema.repos.removedAt),
				),
			)
			.limit(1);
		return await orgServices.linkOrgInstallation(db, {
			orgId: org.id,
			installationId: data.installationId,
			forge: data.forge,
			accountLogin: owner[0]?.owner,
		});
	});

/**
 * §11 move-installation: re-home an installation (and its repos + history)
 * to another org. Requires ADMIN OF BOTH SIDES — the source (middleware) and
 * the target (checked here).
 */
export const moveInstallationToOrg = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator(
		(input: { org: string; installationId: string; toOrg: string }) => input,
	)
	.handler(
		async ({ data, context }): Promise<{ moved: boolean; error?: string }> => {
			const source = (context as { org: OrgWithRole }).org;
			const { requireSession } = await import("#/lib/server/session");
			const userId = await requireSession();
			const { getDb } = await import("#/lib/server/db");
			const { orgServices } = await import("@tripwire/db");
			const db = getDb().db;
			// The middleware proved source-admin; prove target-admin the same way.
			if (userId) {
				const { assertOrgRole } = await import("@tripwire/auth/org-gate");
				const target = await assertOrgRole(db, {
					userId,
					orgSlug: data.toOrg,
					need: "admin",
				});
				if (!target.ok) {
					return { moved: false, error: "you need admin on the target org" };
				}
				// Source must actually own the installation being moved.
				const ownerOrg = await orgServices.getInstallationOrg(db, {
					installationId: data.installationId,
				});
				if (ownerOrg !== source.id) {
					return { moved: false, error: "installation is not in this org" };
				}
				return await orgServices.moveInstallation(db, {
					installationId: data.installationId,
					toOrgId: target.org.id,
				});
			}
			return { moved: false, error: "sign in required" };
		},
	);

export interface ClaimableInstallation {
	installationId: string;
	/** Which forge the unclaimed repos live on — drives "connect {forge}" copy
	 * and is passed back on claim so the org binding hits the right rows. */
	forge: Forge;
	account: string | null;
	repoCount: number;
}

/**
 * Unclaimed installations the webhook has already synced (repos with NULL
 * org_id). Recovery path for GitHub's id-less Setup callbacks: when the App
 * is ALREADY installed on the chosen account, GitHub bounces back with
 * `setup_action=install` and a state but NO installation_id — the id must be
 * recovered from what the webhook delivered. Session-gated only; claiming
 * remains a separate admin-gated act.
 */
export const listClaimableInstallations = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<ClaimableInstallation[]> => {
		const { getDb } = await import("#/lib/server/db");
		const { sql } = await import("drizzle-orm");
		const result = await getDb().db.execute(sql`
			SELECT r.installation_id AS "installationId",
			       r.forge AS forge,
			       min(r.owner) AS account,
			       count(*)::int AS "repoCount"
			FROM repos r
			LEFT JOIN organization_installations oi
			  ON oi.installation_id = r.installation_id AND oi.forge = r.forge
			WHERE r.installation_id IS NOT NULL
			  AND r.installation_id <> ''
			  AND r.removed_at IS NULL
			  AND oi.id IS NULL
			GROUP BY r.installation_id, r.forge
			ORDER BY min(r.installed_at) DESC
		`);
		return result.rows as unknown as ClaimableInstallation[];
	});
