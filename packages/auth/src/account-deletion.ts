import {
	accountDeletionServices,
	type Db,
	type DeletedAccount,
	type OrgInstallation,
	orgServices,
	type SoleAdminOrg,
} from "@tripwire/db";
import {
	isBuiltInOrgRole,
	type OrgPermission,
	resolveOrgPermissions,
	roleNames,
} from "./org-access.ts";

const TURN_OFF: OrgPermission = "connections:manage";

export interface OnRepoToTurnOff {
	id: string;
	fullName: string;
	orgSlug: string;
	orgName: string;
}

export interface AccountDeletionPlan {
	soleAdminOrgs: SoleAdminOrg[];
	onRepos: OnRepoToTurnOff[];
	personalOrg: { slug: string; name: string } | null;
	installations: OrgInstallation[];
	pendingReviews: number;
	agents: number;
	sessions: number;
}

async function permissionsOf(
	db: Db,
	orgId: string,
	roles: readonly string[],
): Promise<OrgPermission[][]> {
	const custom = [
		...new Set(
			roles.flatMap((role) =>
				roleNames(role).filter((name) => !isBuiltInOrgRole(name)),
			),
		),
	];
	const rows = await orgServices.getOrgRoles(db, orgId, custom);
	return roles.map((role) => resolveOrgPermissions(role, rows));
}

async function onlyOneWhoCanTurnOff(
	db: Db,
	input: { orgId: string; userId: string; role: string },
): Promise<boolean> {
	const [own = []] = await permissionsOf(db, input.orgId, [input.role]);
	if (!own.includes(TURN_OFF)) {
		return false;
	}
	const others = await accountDeletionServices.listOtherMemberRoles(db, {
		orgId: input.orgId,
		userId: input.userId,
	});
	const otherPermissions = await permissionsOf(db, input.orgId, others);
	return !otherPermissions.some((held) => held.includes(TURN_OFF));
}

export async function planAccountDeletion(
	db: Db,
	userId: string,
): Promise<AccountDeletionPlan> {
	const memberships = await accountDeletionServices.listAccountMemberships(
		db,
		userId,
	);
	const soleTurnOff = [];
	for (const membership of memberships) {
		if (
			membership.isPersonal ||
			(await onlyOneWhoCanTurnOff(db, {
				orgId: membership.orgId,
				userId,
				role: membership.role,
			}))
		) {
			soleTurnOff.push(membership);
		}
	}
	const orgById = new Map(soleTurnOff.map((org) => [org.orgId, org]));
	const repos = await accountDeletionServices.listOnRepos(db, [
		...orgById.keys(),
	]);
	const personal = memberships.filter((org) => org.isPersonal);
	const personalIds = personal.map((org) => org.orgId);
	const [soleAdminOrgs, installations, pendingReviews, agents, sessions] =
		await Promise.all([
			accountDeletionServices.listSoleAdminOrgs(db, userId),
			accountDeletionServices.listOrgInstallations(db, personalIds),
			accountDeletionServices.countPendingReviews(db, personalIds),
			accountDeletionServices.countAgentGrants(db, userId),
			accountDeletionServices.countLiveSessions(db, userId),
		]);
	const first = personal[0];
	return {
		soleAdminOrgs,
		onRepos: repos.flatMap((repo) => {
			const org = orgById.get(repo.orgId);
			return org
				? [
						{
							id: repo.id,
							fullName: repo.fullName,
							orgSlug: org.slug,
							orgName: org.name,
						},
					]
				: [];
		}),
		personalOrg: first ? { slug: first.slug, name: first.name } : null,
		installations,
		pendingReviews,
		agents,
		sessions,
	};
}

export type AccountDeletionResult =
	| { ok: true; deleted: DeletedAccount }
	| { ok: false; reason: "sole-admin"; orgSlugs: string[] }
	| { ok: false; reason: "repos-on"; repos: string[] };

export async function deleteAccount(
	db: Db,
	userId: string,
): Promise<AccountDeletionResult> {
	const plan = await planAccountDeletion(db, userId);
	if (plan.soleAdminOrgs.length > 0) {
		return {
			ok: false,
			reason: "sole-admin",
			orgSlugs: plan.soleAdminOrgs.map((org) => org.slug),
		};
	}
	if (plan.onRepos.length > 0) {
		return {
			ok: false,
			reason: "repos-on",
			repos: plan.onRepos.map((repo) => repo.fullName),
		};
	}
	try {
		return {
			ok: true,
			deleted: await accountDeletionServices.deleteUserAccount(db, userId),
		};
	} catch (error) {
		if (error instanceof accountDeletionServices.AccountDeletionBlockedError) {
			return { ok: false, reason: "sole-admin", orgSlugs: error.orgSlugs };
		}
		throw error;
	}
}
