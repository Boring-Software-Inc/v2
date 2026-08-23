import {
	createBotJwt,
	OPEN_GIT_API_BASE,
	type OpenGitBotCredentials,
} from "./auth.ts";

/**
 * One repository an installation grants, in the shape tripwire stores.
 * `private` is absent from open-git's response, so it is NOT guessed here —
 * the caller decides, and the honest default is fail-closed (§10).
 */
export interface OpenGitInstallationRepo {
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
}

interface InstallationResponse {
	id: string;
	status: string;
	repositories?: { id: string; name: string; owner: string }[];
}

/**
 * The repositories an installation currently grants.
 *
 * This exists because open-git's `installation.created` / `.repos_changed`
 * webhooks name repositories by BARE UUID — no owner, no name — so the delivery
 * alone cannot build a repo row. The api does return both, so the worker asks.
 *
 * Authenticated with the BOT JWT, not an installation token: the caller has no
 * repo to mint an installation token against yet. That is the whole point — it
 * is discovering which repos exist.
 */
export async function listInstallationRepos(
	creds: OpenGitBotCredentials,
	installationId: string,
	apiBase = OPEN_GIT_API_BASE,
	fetchImpl: typeof fetch = fetch,
): Promise<{ repos: OpenGitInstallationRepo[]; active: boolean }> {
	const res = await fetchImpl(
		`${apiBase}/api/v1/app/installations/${installationId}`,
		{
			headers: {
				authorization: `Bearer ${createBotJwt(creds)}`,
				accept: "application/json",
			},
		},
	);
	if (!res.ok) {
		throw new Error(
			`installation lookup failed: ${res.status} ${await res.text()}`,
		);
	}
	const data = (await res.json()) as InstallationResponse;
	return {
		active: data.status === "active",
		repos: (data.repositories ?? []).map((repo) => ({
			externalId: repo.id,
			owner: repo.owner,
			name: repo.name,
			fullName: `${repo.owner}/${repo.name}`,
		})),
	};
}
