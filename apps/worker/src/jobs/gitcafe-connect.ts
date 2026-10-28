import {
	type GitCafeConnectionJob,
	type GitCafeConnectionRepository,
	type GitCafeConnectionResult,
	type GitCafeInstallation,
	gitCafeConnectionJobSchema,
	gitCafeConnectionRepositoriesSchema,
} from "@tripwire/contracts";
import {
	type Db,
	gitCafeConnectionServices,
	gitCafeLifecycleServices,
} from "@tripwire/db";
import type { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";

export const GITCAFE_STAGING_APP_ID = "int_01m60999c0fqg841d48s29qwtv";
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

export interface GitCafeConnectionDeps {
	db: Db;
	lifecycleEnabled?: boolean;
	client: Pick<
		GitCafeInstallationClient,
		"getInstallation" | "getOrganizationMembers" | "getRepositories"
	>;
}

interface ConnectionAuthority {
	installation: GitCafeInstallation;
	repositories: GitCafeConnectionRepository[];
}

async function readAuthority(
	deps: GitCafeConnectionDeps,
	job: GitCafeConnectionJob,
): Promise<
	| { ok: true; value: ConnectionAuthority }
	| Exclude<GitCafeConnectionResult, { ok: true }>
> {
	try {
		if (job.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
		const lookup = await deps.client.getInstallation(
			job.installationId,
			job.expiresAt,
		);
		if (!lookup.ok)
			return {
				ok: false,
				reason:
					lookup.reason === "expired"
						? "expired"
						: lookup.reason === "stale"
							? "installation-mismatch"
							: "authority-unavailable",
			};
		const installation = lookup.value;
		if (
			installation.id !== job.installationId ||
			installation.appId !== GITCAFE_STAGING_APP_ID ||
			installation.pausedAt !== null ||
			installation.suspendedAt !== null ||
			installation.uninstalledAt !== null ||
			!SEGMENT.test(installation.org) ||
			installation.repositories.some((name) => !SEGMENT.test(name)) ||
			new Set(installation.repositories).size !==
				installation.repositories.length
		)
			return { ok: false, reason: "installation-mismatch" };
		const checkAdmin = async () => {
			const members = await deps.client.getOrganizationMembers(
				job.installationId,
				installation.org,
				installation,
				job.expiresAt,
			);
			if (
				job.expiresAt <= Date.now() ||
				(!members.ok && members.reason === "expired")
			)
				return "expired" as const;
			if (!members.ok && members.reason === "stale")
				return "installation-mismatch" as const;
			if (!members.ok || members.value.next !== null)
				return "authority-unavailable" as const;
			const actor = members.value.items.filter(
				(entry) => entry.actorId === job.actorId,
			);
			return actor.length === 1 &&
				["org-owner", "org-admin"].includes(actor[0]?.role ?? "")
				? null
				: ("not-admin" as const);
		};
		const initialAdmin = await checkAdmin();
		if (initialAdmin) return { ok: false, reason: initialAdmin };
		const discovery = await deps.client.getRepositories(
			job.installationId,
			installation.org,
			installation,
			job.expiresAt,
		);
		if (
			job.expiresAt <= Date.now() ||
			(!discovery.ok && discovery.reason === "expired")
		)
			return { ok: false, reason: "expired" };
		if (!discovery.ok)
			return {
				ok: false,
				reason:
					discovery.reason === "stale"
						? "installation-mismatch"
						: "repository-mismatch",
			};
		const parsed = gitCafeConnectionRepositoriesSchema.safeParse(
			discovery.value,
		);
		if (!parsed.success) return { ok: false, reason: "repository-mismatch" };
		const repositories = parsed.data.sort((a, b) =>
			a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
		);
		const selected = new Set(installation.repositories);
		if (
			new Set(repositories.map((repo) => repo.id)).size !==
				repositories.length ||
			new Set(repositories.map((repo) => repo.name)).size !==
				repositories.length ||
			repositories.some(
				(repo) =>
					repo.owner !== installation.org ||
					!SEGMENT.test(repo.name) ||
					repo.archivedAt !== null ||
					(installation.repositorySelection === "selected" &&
						!selected.has(repo.name)),
			) ||
			(installation.repositorySelection === "selected" &&
				repositories.length !== selected.size)
		)
			return { ok: false, reason: "repository-mismatch" };
		const current = await deps.client.getInstallation(
			job.installationId,
			job.expiresAt,
		);
		if (
			job.expiresAt <= Date.now() ||
			(!current.ok && current.reason === "expired")
		)
			return { ok: false, reason: "expired" };
		if (
			!current.ok ||
			JSON.stringify(current.value) !== JSON.stringify(installation)
		)
			return { ok: false, reason: "installation-mismatch" };
		const finalAdmin = await checkAdmin();
		if (finalAdmin) return { ok: false, reason: finalAdmin };
		return { ok: true, value: { installation, repositories } };
	} catch {
		return {
			ok: false,
			reason: job.expiresAt <= Date.now() ? "expired" : "authority-unavailable",
		};
	}
}

export async function connectGitCafeInstallation(
	deps: GitCafeConnectionDeps,
	input: GitCafeConnectionJob,
): Promise<GitCafeConnectionResult> {
	const parsed = gitCafeConnectionJobSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid-job" };
	const job = parsed.data;
	if (job.authorizedAt > Date.now() || job.expiresAt <= Date.now())
		return { ok: false, reason: "expired" };
	if (
		!(await gitCafeConnectionServices.canManageGitCafeConnection(deps.db, job))
	)
		return { ok: false, reason: "unauthorized" };
	let expectedGeneration: number | undefined;
	let reconciledInstallation: GitCafeInstallation | undefined;
	if (deps.lifecycleEnabled) {
		const claim = await gitCafeConnectionServices.getGitCafeConnectionClaim(
			deps.db,
			job.installationId,
		);
		if (claim && claim.organizationId !== job.orgId)
			return { ok: false, reason: "ownership-conflict" };
		const reconciliation =
			await gitCafeLifecycleServices.reconcileGitCafeInstallation(deps.db, {
				installationId: job.installationId,
				expectedAppId: GITCAFE_STAGING_APP_ID,
				expectedOwner: claim?.accountLogin ?? undefined,
				organizationId: job.orgId,
				lookup: async () => {
					const result = await deps.client.getInstallation(
						job.installationId,
						job.expiresAt,
					);
					if (result.ok) reconciledInstallation = result.value;
					return result;
				},
			});
		if (job.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
		if (!reconciliation.ok || reconciliation.status !== "active")
			return {
				ok: false,
				reason:
					reconciliation.ok && reconciliation.status === "reconcile-required"
						? "authority-unavailable"
						: "installation-mismatch",
			};
		expectedGeneration = reconciliation.generation;
	}
	const authority = await readAuthority(deps, job);
	if (!authority.ok) {
		if (deps.lifecycleEnabled)
			await gitCafeConnectionServices.withdrawGitCafeConnectionClaim(
				deps.db,
				job,
			);
		return authority;
	}
	if (deps.lifecycleEnabled) {
		if (
			JSON.stringify(reconciledInstallation) !==
			JSON.stringify(authority.value.installation)
		) {
			await gitCafeConnectionServices.withdrawGitCafeConnectionClaim(
				deps.db,
				job,
			);
			return { ok: false, reason: "installation-mismatch" };
		}
		const claims = await gitCafeConnectionServices.listGitCafeConnectionClaims(
			deps.db,
			job.orgId,
			authority.value.installation.org,
		);
		for (const claim of claims) {
			if (claim.installationId === job.installationId) continue;
			await gitCafeLifecycleServices.reconcileGitCafeInstallation(deps.db, {
				installationId: claim.installationId,
				expectedAppId: GITCAFE_STAGING_APP_ID,
				expectedOwner: authority.value.installation.org,
				organizationId: job.orgId,
				lookup: () =>
					deps.client.getInstallation(claim.installationId, job.expiresAt),
			});
		}
	}
	return await gitCafeConnectionServices.commitGitCafeConnection(deps.db, {
		job,
		owner: authority.value.installation.org,
		repositories: authority.value.repositories,
		lifecycleEnabled: deps.lifecycleEnabled,
		expectedGeneration,
		revalidate: async () => {
			const current = await readAuthority(deps, job);
			if (!current.ok) return current;
			return JSON.stringify(current.value) === JSON.stringify(authority.value)
				? { ok: true, repoCount: current.value.repositories.length }
				: { ok: false, reason: "installation-mismatch" };
		},
	});
}
