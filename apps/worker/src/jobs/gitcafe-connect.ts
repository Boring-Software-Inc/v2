import {
	type GitCafeConnectionJob,
	type GitCafeConnectionRepository,
	type GitCafeConnectionResult,
	type GitCafeInstallation,
	gitCafeConnectionJobSchema,
	gitCafeConnectionRepositorySchema,
	gitCafeOrganizationMembersSchema,
} from "@tripwire/contracts";
import { type Db, gitCafeConnectionServices } from "@tripwire/db";
import type { GitCafeInstallationClient } from "@tripwire/forge-gitcafe";

export const GITCAFE_STAGING_APP_ID = "int_01m60999c0fqg841d48s29qwtv";
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface GitCafeConnectionDeps {
	db: Db;
	client: Pick<GitCafeInstallationClient, "getInstallation" | "getToken">;
	fetch: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>;
}

interface ConnectionAuthority {
	installation: GitCafeInstallation;
	repositories: GitCafeConnectionRepository[];
}

async function readJson(
	http: GitCafeConnectionDeps["fetch"],
	path: string,
	token: string,
): Promise<unknown> {
	const response = await http(`https://git.cafe/api/${path}`, {
		method: "GET",
		headers: { accept: "application/json", authorization: `Bearer ${token}` },
		redirect: "manual",
		signal: AbortSignal.timeout(10_000),
	});
	if (
		!response.ok ||
		!response.headers.get("content-type")?.includes("application/json")
	) {
		await response.body?.cancel();
		return null;
	}
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
		const credential = await deps.client.getToken(job.installationId);
		if (!credential.ok) return { ok: false, reason: "authority-unavailable" };
		const members = gitCafeOrganizationMembersSchema.safeParse(
			await readJson(
				deps.fetch,
				`orgs/${encodeURIComponent(installation.org)}/members/`,
				credential.value,
			),
		);
		if (!members.success || members.data.next !== null)
			return { ok: false, reason: "authority-unavailable" };
		const actor = members.data.items.filter(
			(entry) => entry.actorId === job.actorId,
		);
		if (
			actor.length !== 1 ||
			!["org-owner", "org-admin"].includes(actor[0]?.role ?? "")
		)
			return { ok: false, reason: "not-admin" };
		const repositories: GitCafeConnectionRepository[] = [];
		for (const name of installation.repositories) {
			const repo = gitCafeConnectionRepositorySchema.safeParse(
				await readJson(
					deps.fetch,
					`repos/${encodeURIComponent(installation.org)}/${encodeURIComponent(name)}`,
					credential.value,
				),
			);
			if (
				!repo.success ||
				repo.data.name !== name ||
				repo.data.owner !== installation.org ||
				repo.data.archivedAt !== null
			)
				return { ok: false, reason: "repository-mismatch" };
			repositories.push(repo.data);
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
