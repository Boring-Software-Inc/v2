/**
 * A small GitLab REST client. Reads and actions share it.
 * The shape matches `GithubHttp` on purpose, so the worker wires both forges
 * the same way: give it a `tokenFor(repoFullName)` function and an optional
 * metering hook.
 *
 * GitLab uses ONE OAuth access token per linked account (not a per-repo
 * installation token like GitHub). The worker still maps repo -> account token
 * through `tokenFor`, so this seam stays identical.
 */
export interface GitlabHttpOptions {
	tokenFor(repoFullName: string): Promise<string>;
	/** The API base. Defaults to gitlab.com. Self-managed GitLab sets its own. */
	apiBase?: string;
	fetchImpl?: typeof fetch;
	/**
	 * Best-effort metering hook. It runs once per request with the byte sizes.
	 * It observes only. A throw here must never break a call.
	 */
	onCall?: (bytes: { bytesIn: number; bytesOut: number }) => void;
}

/** URL-encode a project path like `group/sub/project` for the REST API. */
export function encodeProject(repoFullName: string): string {
	return encodeURIComponent(repoFullName);
}

export class GitlabHttp {
	readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: GitlabHttpOptions) {
		this.apiBase = options.apiBase ?? "https://gitlab.com/api/v4";
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async request(
		repoFullName: string,
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<unknown> {
		const token = await this.options.tokenFor(repoFullName);
		const sentBody = body === undefined ? undefined : JSON.stringify(body);
		const res = await this.fetchImpl(`${this.apiBase}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/json",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: sentBody,
		});
		// One text read serves both the byte count and the parse. Metering adds
		// no extra network work. `onCall` observes only.
		const text = await res.text();
		try {
			this.options.onCall?.({
				bytesIn: text.length,
				bytesOut: sentBody ? sentBody.length : 0,
			});
		} catch {
			// Metering must never fail a forge call.
		}
		if (!res.ok) {
			throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
		}
		return res.status === 204 || text.length === 0 ? null : JSON.parse(text);
	}

	get(repo: string, path: string): Promise<unknown> {
		return this.request(repo, "GET", path);
	}
	post(repo: string, path: string, body: unknown): Promise<unknown> {
		return this.request(repo, "POST", path, body);
	}
	put(repo: string, path: string, body: unknown): Promise<unknown> {
		return this.request(repo, "PUT", path, body);
	}
}
