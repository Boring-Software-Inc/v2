import {
	type GitCafeConnectionJob,
	type GitCafeConnectionRepository,
	type GitCafeConnectionResult,
	type GitCafeInstallation,
	gitCafeConnectionJobSchema,
} from "@tripwire/contracts";
import { type Db, gitCafeConnectionServices } from "@tripwire/db";
import type { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";

export const GITCAFE_STAGING_APP_ID = "int_01m60999c0fqg841d48s29qwtv";
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

export interface GitCafeConnectionDeps {
	db: Db;
	client: Pick<
		GitCafeInstallationClient,
		"getInstallation" | "getOrganizationMembers" | "getRepository"
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
		const lookup = await deps.client.getInstallation(job.installationId);
		if (!lookup.ok) return { ok: false, reason: "authority-unavailable" };
		const installation = lookup.value;
		if (
			installation.id !== job.installationId ||
			installation.appId !== GITCAFE_STAGING_APP_ID ||
			installation.pausedAt !== null ||
			installation.suspendedAt !== null ||
			installation.uninstalledAt !== null ||
			!SEGMENT.test(installation.org) ||
			installation.repositorySelection !== "selected" ||
			installation.repositories.length === 0 ||
			installation.repositories.length > 100 ||
			installation.repositories.some((name) => !SEGMENT.test(name)) ||
			new Set(installation.repositories).size !==
				installation.repositories.length
		)
			return { ok: false, reason: "installation-mismatch" };
		const checkAdmin = async () => {
			const members = await deps.client.getOrganizationMembers(
				job.installationId,
				installation.org,
			);
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
		const repositories: GitCafeConnectionRepository[] = [];
		for (const name of installation.repositories) {
			const repo = await deps.client.getRepository(
				job.installationId,
				installation.org,
				name,
			);
			if (
				!repo.ok ||
				repo.value.name !== name ||
				repo.value.owner !== installation.org ||
				repo.value.archivedAt !== null
			)
				return { ok: false, reason: "repository-mismatch" };
			repositories.push(repo.value);
		}
		if (
			new Set(repositories.map((repo) => repo.id)).size !== repositories.length
		)
			return { ok: false, reason: "repository-mismatch" };
		const current = await deps.client.getInstallation(job.installationId);
		if (
			!current.ok ||
			JSON.stringify(current.value) !== JSON.stringify(installation)
		)
			return { ok: false, reason: "installation-mismatch" };
		const finalAdmin = await checkAdmin();
		if (finalAdmin) return { ok: false, reason: finalAdmin };
		return { ok: true, value: { installation, repositories } };
	} catch {
		return { ok: false, reason: "authority-unavailable" };
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
	const authority = await readAuthority(deps, job);
	if (!authority.ok) return authority;
	return await gitCafeConnectionServices.commitGitCafeConnection(deps.db, {
		job,
		owner: authority.value.installation.org,
		repositories: authority.value.repositories,
		revalidate: async () => {
			const current = await readAuthority(deps, job);
			if (!current.ok) return current;
			return JSON.stringify(current.value) === JSON.stringify(authority.value)
				? { ok: true, repoCount: current.value.repositories.length }
				: { ok: false, reason: "installation-mismatch" };
		},
	});
}
