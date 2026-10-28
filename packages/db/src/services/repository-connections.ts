import {
	type Forge,
	forgeSchema,
	type OrganizationForgeConnection,
	organizationForgeConnectionsSchema,
} from "@tripwire/contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import { gitCafeInstallationLifecycle } from "../schema/gitcafe-lifecycle.ts";
import { organizationInstallations } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { readObservedInstallationAccounts } from "./installation-accounts.ts";

/** Installation grants belong to an organization; sign-in account IDs and OAuth token expiry do not describe them. */
export async function listOrganizationForgeConnections(
	db: Db,
	orgId: string,
): Promise<OrganizationForgeConnection[]> {
	const [claims, repositories] = await Promise.all([
		db
			.select({
				forge: organizationInstallations.forge,
				installationId: organizationInstallations.installationId,
				owner: organizationInstallations.accountLogin,
				accountType: organizationInstallations.accountType,
				lifecycle: gitCafeInstallationLifecycle.status,
			})
			.from(organizationInstallations)
			.leftJoin(
				gitCafeInstallationLifecycle,
				and(
					eq(organizationInstallations.forge, "gitcafe"),
					eq(
						organizationInstallations.installationId,
						gitCafeInstallationLifecycle.installationId,
					),
				),
			)
			.where(eq(organizationInstallations.organizationId, orgId)),
		db
			.select({
				id: repos.id,
				forge: repos.forge,
				fullName: repos.fullName,
				installationId: repos.installationId,
				lifecycle: gitCafeInstallationLifecycle.status,
			})
			.from(repos)
			.leftJoin(
				gitCafeInstallationLifecycle,
				and(
					eq(repos.forge, "gitcafe"),
					eq(repos.installationId, gitCafeInstallationLifecycle.installationId),
				),
			)
			.where(and(eq(repos.orgId, orgId), isNull(repos.removedAt))),
	]);
	const observedAccounts = await readObservedInstallationAccounts(
		db,
		"github",
		claims
			.filter(
				(claim) =>
					claim.forge === "github" &&
					(claim.accountType === null || claim.owner === null),
			)
			.map((claim) => claim.installationId),
	);
	const grouped = new Map<Forge, OrganizationForgeConnection>();
	for (const claim of claims) {
		const forge = forgeSchema.safeParse(claim.forge);
		if (
			!forge.success ||
			(forge.data === "gitcafe" &&
				claim.lifecycle !== null &&
				claim.lifecycle !== "active" &&
				claim.lifecycle !== "reconcile-required")
		)
			continue;
		const group = grouped.get(forge.data) ?? {
			forge: forge.data,
			installations: [],
			repositories: [],
		};
		const observed =
			forge.data === "github"
				? observedAccounts.get(claim.installationId)
				: undefined;
		const sameAccount =
			claim.owner === null ||
			observed?.account.toLowerCase() === claim.owner.toLowerCase();
		group.installations.push({
			installationId: claim.installationId,
			owner: claim.owner ?? observed?.account ?? null,
			accountType:
				claim.accountType ??
				(sameAccount ? observed?.accountType : null) ??
				null,
		});
		grouped.set(forge.data, group);
	}
	for (const repo of repositories) {
		if (
			repo.forge === "gitcafe" &&
			repo.lifecycle !== null &&
			repo.lifecycle !== "active" &&
			repo.lifecycle !== "reconcile-required"
		)
			continue;
		const group = grouped.get(repo.forge) ?? {
			forge: repo.forge,
			installations: [],
			repositories: [],
		};
		group.repositories.push({
			id: repo.id,
			fullName: repo.fullName,
			installationId: repo.installationId,
		});
		grouped.set(repo.forge, group);
	}
	for (const group of grouped.values())
		group.repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
	return organizationForgeConnectionsSchema.parse(
		[...grouped.values()].sort((a, b) => a.forge.localeCompare(b.forge)),
	);
}
