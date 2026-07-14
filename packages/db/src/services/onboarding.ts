import { generateId } from "@tripwire/utils";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import { forgeIdentities, user, userInstallations } from "../schema/auth.ts";
import { repos } from "../schema/repos.ts";

/**
 * Onboarding (§10): tie the signed-in user to their App installation and their
 * ONE active repo. Repos are reached through the installation
 * (`repos.installation_id = user_installations.installation_id`); all granted
 * repos stay synced, only the active one scopes the dashboard.
 */

export interface RepoLite {
	id: string;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
}

const REPO_LITE = {
	id: repos.id,
	owner: repos.owner,
	name: repos.name,
	fullName: repos.fullName,
	private: repos.private,
} as const;

/**
 * Claim an installation for a user (Setup URL callback, from the signed-in
 * session). Idempotent; the `(forge, installationId)` unique means a second
 * user cannot steal an already-claimed installation — the insert is a no-op and
 * `claimed` reports whether THIS user now owns it.
 */
export async function linkUserInstallation(
	db: Db,
	input: { userId: string; installationId: string; forge?: string },
): Promise<{ claimed: boolean }> {
	const forge = input.forge ?? "github";
	await db
		.insert(userInstallations)
		.values({
			id: generateId(),
			userId: input.userId,
			forge,
			installationId: input.installationId,
		})
		.onConflictDoNothing({
			target: [userInstallations.forge, userInstallations.installationId],
		});
	const owner = await db
		.select({ userId: userInstallations.userId })
		.from(userInstallations)
		.where(
			and(
				eq(userInstallations.forge, forge),
				eq(userInstallations.installationId, input.installationId),
			),
		);
	return { claimed: owner[0]?.userId === input.userId };
}

/**
 * Claim an installation for the user who INSTALLED it, matched by their forge
 * identity from the `installation` webhook's actor. This is the DURABLE link
 * path: it does not depend on the browser carrying `installation_id` through
 * GitHub's post-install redirect (the Setup URL callback is the fallback). A
 * no-op when the installer has no `forge_identities` row yet (they installed
 * before signing in) — onboarding's callback still links them later. Idempotent
 * via `linkUserInstallation`'s `(forge, installationId)` unique.
 */
export async function claimInstallationForForgeUser(
	db: Db,
	input: {
		forge?: string;
		installerExternalId: string;
		installationId: string;
	},
): Promise<{ claimed: boolean; userId: string | null }> {
	const forge = input.forge ?? "github";
	const identities = await db
		.select({ userId: forgeIdentities.userId })
		.from(forgeIdentities)
		.where(
			and(
				eq(forgeIdentities.forge, forge),
				eq(forgeIdentities.externalId, input.installerExternalId),
			),
		)
		.limit(1);
	const userId = identities[0]?.userId ?? null;
	if (!userId) {
		return { claimed: false, userId: null };
	}
	const { claimed } = await linkUserInstallation(db, {
		userId,
		installationId: input.installationId,
		forge,
	});
	return { claimed, userId };
}

/** Every non-removed repo the user's installations grant. */
export async function listUserRepos(
	db: Db,
	userId: string,
): Promise<RepoLite[]> {
	return await db
		.select(REPO_LITE)
		.from(repos)
		.innerJoin(
			userInstallations,
			and(
				eq(userInstallations.installationId, repos.installationId),
				eq(userInstallations.forge, repos.forge),
			),
		)
		.where(and(eq(userInstallations.userId, userId), isNull(repos.removedAt)));
}

/** The user's active repo, or null (also null if it was later uninstalled). */
export async function getActiveRepo(
	db: Db,
	userId: string,
): Promise<RepoLite | null> {
	const rows = await db
		.select(REPO_LITE)
		.from(user)
		.innerJoin(repos, eq(repos.id, user.activeRepoId))
		.where(and(eq(user.id, userId), isNull(repos.removedAt)));
	return rows[0] ?? null;
}

/**
 * Set the active repo — only a repo the user actually has access to (guards
 * against setting someone else's repo). Returns false when the repo isn't
 * theirs.
 */
export async function setActiveRepo(
	db: Db,
	userId: string,
	repoId: string,
): Promise<boolean> {
	const granted = await listUserRepos(db, userId);
	if (!granted.some((r) => r.id === repoId)) {
		return false;
	}
	await db
		.update(user)
		.set({ activeRepoId: repoId })
		.where(eq(user.id, userId));
	return true;
}

export interface OnboardingState {
	hasInstallation: boolean;
	repos: RepoLite[];
	activeRepo: RepoLite | null;
}

/** Everything /onboarding + the redirect gate need in one round-trip. */
export async function getOnboardingState(
	db: Db,
	userId: string,
): Promise<OnboardingState> {
	const installs = await db
		.select({ id: userInstallations.id })
		.from(userInstallations)
		.where(eq(userInstallations.userId, userId))
		.limit(1);
	const [granted, activeRepo] = await Promise.all([
		listUserRepos(db, userId),
		getActiveRepo(db, userId),
	]);
	return {
		hasInstallation: installs.length > 0,
		repos: granted,
		activeRepo,
	};
}
