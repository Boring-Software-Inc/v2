import { allowlistGitHubAccountSchema } from "@tripwire/contracts";

export async function lookupGitHubAccount(
	login: string,
	headers: HeadersInit = { Accept: "application/vnd.github+json" },
	request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
	const profile = await request(
		`https://api.github.com/users/${encodeURIComponent(login)}`,
		{ headers, redirect: "error", signal: AbortSignal.timeout(5_000) },
	);
	if (profile.status === 404) return null;
	if (!profile.ok) throw new Error(`GitHub lookup returned ${profile.status}`);
	return allowlistGitHubAccountSchema.parse(await profile.json());
}
