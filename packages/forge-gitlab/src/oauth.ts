/**
 * GitLab OAuth (PoC). This replaces GitHub's App-installation flow. GitLab has
 * no "installation" object. A maintainer links a GitLab account with OAuth, and
 * the worker uses that account's access token for reads and actions.
 *
 * The onboarding step (rows in `org_installations` / `forge_identities`) is out
 * of scope for this PoC. These helpers only build the OAuth URLs and exchange
 * the code. The scope `api` grants merge-request reads, notes, labels, and
 * commit statuses — everything the adapter needs.
 */

export interface GitlabOAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	/** The GitLab base URL. Defaults to gitlab.com. */
	baseUrl?: string;
}

export interface GitlabOAuthTokens {
	accessToken: string;
	refreshToken: string | null;
	/** Seconds until the access token expires. */
	expiresIn: number | null;
}

const DEFAULT_BASE = "https://gitlab.com";

/** Build the URL the login button opens. `state` is the CSRF guard. */
export function gitlabAuthorizeUrl(
	config: GitlabOAuthConfig,
	state: string,
): string {
	const base = config.baseUrl ?? DEFAULT_BASE;
	const query = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: "code",
		state,
		scope: "api",
	});
	return `${base}/oauth/authorize?${query.toString()}`;
}

/**
 * Trade a refresh token for a fresh pair. GitLab access tokens expire in 2h and
 * refresh tokens are SINGLE USE — the response's `refresh_token` replaces the
 * one sent, so a caller that drops it has bricked the account until the user
 * re-authorizes. Persist both, always.
 */
export async function refreshGitlabToken(
	config: Omit<GitlabOAuthConfig, "redirectUri">,
	refreshToken: string,
	fetchImpl: typeof fetch = fetch,
): Promise<GitlabOAuthTokens> {
	const base = config.baseUrl ?? DEFAULT_BASE;
	const res = await fetchImpl(`${base}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});
	if (!res.ok) {
		throw new Error(`gitlab token refresh failed: ${res.status}`);
	}
	const data = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? null,
		expiresIn: data.expires_in ?? null,
	};
}

/** Exchange the OAuth code for tokens. Call this in the redirect handler. */
export async function exchangeGitlabCode(
	config: GitlabOAuthConfig,
	code: string,
	fetchImpl: typeof fetch = fetch,
): Promise<GitlabOAuthTokens> {
	const base = config.baseUrl ?? DEFAULT_BASE;
	const res = await fetchImpl(`${base}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			grant_type: "authorization_code",
			redirect_uri: config.redirectUri,
		}),
	});
	if (!res.ok) {
		throw new Error(`gitlab oauth exchange failed: ${res.status}`);
	}
	const data = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? null,
		expiresIn: data.expires_in ?? null,
	};
}
