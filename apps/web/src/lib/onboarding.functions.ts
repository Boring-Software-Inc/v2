import { createServerFn } from "@tanstack/react-start";
import type { InstallUrlState } from "@tripwire/auth/install-state";
import {
	type ClaimableInstallStatus,
	type Forge,
	forgeConnectable,
	type InstallStatus,
} from "@tripwire/contracts";
import type {
	ApprovedInstallRequest,
	ClaimableInstallation,
	OrgWithRole,
	SwitcherRepo,
} from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgMemberMiddleware,
	orgPermissionMiddleware,
} from "#/lib/server/org-guard";

export type {
	ApprovedInstallRequest,
	ClaimableInstallation,
	ClaimableInstallStatus,
	InstallStatus,
	SwitcherRepo,
};

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

export type { InstallUrlState };

/**
 * The install URL FOR THIS ORG, on the forge asked for. Admin-only: installing
 * changes what the org gates.
 */
export const getOrgInstallUrl = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
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
		const { installUrlFor } = await import("@tripwire/auth/install-state");
		return installUrlFor(
			data.forge ?? "github",
			state,
			process.env.GITHUB_APP_SLUG,
		);
	});

export const getInstallPreview = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { installationId: string; state?: string }) => input)
	.handler(async ({ data }): Promise<InstallStatus> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		const { verifyInstallState } = await import("#/lib/server/install-state");
		const bound = data.state ? verifyInstallState(data.state) : null;
		const status = await orgServices.resolveInstallStatus(getDb().db, {
			userId,
			installationId: data.installationId,
			stateOrgId: bound && bound.userId === userId ? bound.orgId : null,
		});
		if (forgeConnectable(status.forge)) {
			return status;
		}
		return {
			installationId: status.installationId,
			forge: status.forge,
			status: "not-yours",
			recoverable: false,
		};
	});

export const recoverInstallation = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { installationId: string }) => input)
	.handler(async ({ data }): Promise<{ queued: boolean }> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return { queued: false };
		}
		const { getBoss, getDb } = await import("#/lib/server/db");
		const {
			installationAccessServices,
			RECOVER_INSTALLATION_QUEUE,
			recoverInstallationOptions,
		} = await import("@tripwire/db");
		const job = { userId, installationId: data.installationId };
		await installationAccessServices.recordInstallAccessCheck(getDb().db, {
			userId,
			forge: "github",
			installationId: data.installationId,
			result: "pending",
		});
		const boss = await getBoss();
		await boss.send(
			RECOVER_INSTALLATION_QUEUE,
			job,
			recoverInstallationOptions(job),
		);
		return { queued: true };
	});

/**
 * Bind an installation to THIS org — the confirmation screen's confirm and
 * the claim screen's pick both land here. Admin-gated AND ownership-gated:
 * the caller must have installed or requested the installation (the signed
 * state is not proof of that). Idempotent; a second org cannot steal a claim
 * ((forge, installationId) unique).
 */
export const claimInstallation = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator(
		(input: { org: string; installationId: string; forge: Forge }) => input,
	)
	.handler(async ({ data, context }): Promise<{ claimed: boolean }> => {
		const org = (context as { org: OrgWithRole }).org;
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		const { getDb } = await import("#/lib/server/db");
		const { orgServices, schema } = await import("@tripwire/db");
		const { and, eq, isNull } = await import("drizzle-orm");
		const db = getDb().db;
		const owned =
			userId && forgeConnectable(data.forge)
				? await orgServices.userCanClaimInstallation(db, {
						userId,
						forge: data.forge,
						installationId: data.installationId,
					})
				: false;
		if (!owned) {
			throw new Error(
				"Only an admin of this account on GitHub can connect it. Ask an owner of the account to connect Tripwire.",
			);
		}
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
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
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
					return {
						moved: false,
						error:
							"Only an admin of that org can move an installation into it.",
					};
				}
				// Source must actually own the installation being moved.
				const ownerOrg = await orgServices.getInstallationOrg(db, {
					installationId: data.installationId,
				});
				if (ownerOrg !== source.id) {
					return {
						moved: false,
						error:
							"This installation belongs to a different org. Open that org to move it.",
					};
				}
				return await orgServices.moveInstallation(db, {
					installationId: data.installationId,
					toOrgId: target.org.id,
				});
			}
			return { moved: false, error: "Sign in to continue." };
		},
	);

/**
 * Unclaimed installations the signed-in user installed or requested.
 * Recovery path for GitHub's id-less Setup callbacks: when the App is ALREADY
 * installed on the chosen account, GitHub bounces back with
 * `setup_action=install` and a state but NO installation_id — the id must be
 * recovered from what the webhook delivered.
 */
export const listClaimableInstallations = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<ClaimableInstallation[]> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return [];
		}
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		const installs = await orgServices.listClaimableInstallations(getDb().db, {
			userId,
		});
		return installs.filter((install) => forgeConnectable(install.forge));
	});

export const listApprovedInstallRequests = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<ApprovedInstallRequest[]> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return [];
		}
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		return await orgServices.listApprovedInstallRequests(getDb().db, {
			userId,
		});
	});
