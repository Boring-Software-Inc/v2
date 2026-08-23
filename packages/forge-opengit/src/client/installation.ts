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

/**
 * Whether a repository is PUBLIC, by asking for its page without credentials.
 *
 * open-git stores visibility — `repositories.visibility` is a real column with a
 * `('public','private')` check — but exposes it nowhere: not on the installation
 * response, not on the installation webhooks, not on the pull-request payload.
 * Until it does, this is the only honest read available.
 *
 * The inference is safe in ONE direction only, which is why it is written this
 * way round:
 *
 *   200        the page is served to nobody in particular ⇒ public
 *   anything   private, gone, renamed, or open-git having a bad minute
 *              ⇒ NOT confirmed public
 *
 * A private repository answers 404 unauthenticated, so it can never be read as
 * public. The opposite mistake, a public repository read as private, only hides
 * a run page that would otherwise be visible, and it is what tripwire already
 * did for every open-git repo.
 *
 * Sends no credentials on purpose. An installation token would make a private
 * repository answer 200 and invert the whole inference.
 */
export async function isRepoPublic(
	repoFullName: string,
	origin = "https://open-git.com",
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	try {
		const res = await fetchImpl(
			`${origin.replace(/\/$/, "")}/${repoFullName}`,
			{
				method: "GET",
				// Never follow: a redirect to a sign-in page is a 200 that means the
				// opposite of what it looks like.
				redirect: "manual",
			},
		);
		return res.status === 200;
	} catch {
		// A network failure is not evidence of anything. Fail closed.
		return false;
	}
}
