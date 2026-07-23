/**
 * Minimal authenticated GitHub REST client shared by reads and actions.
 * No octokit — the surface Tripwire touches stays small and visible.
 */
export interface GithubHttpOptions {
	tokenFor(repoFullName: string): Promise<string>;
	apiBase?: string;
	fetchImpl?: typeof fetch;
	/**
	 * Best-effort metering hook, called once per request with the request and
	 * response body sizes. Observes only; a throw here must never break a call,
	 * so the caller keeps it trivial (increment a counter). Optional.
	 */
	onCall?: (bytes: { bytesIn: number; bytesOut: number }) => void;
}

export class GithubHttp {
	readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: GithubHttpOptions) {
		this.apiBase = options.apiBase ?? "https://api.github.com";
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async request(
		repoFullName: string,
		method: "GET" | "POST" | "PATCH" | "PUT",
		path: string,
		body?: unknown,
	): Promise<unknown> {
		const token = await this.options.tokenFor(repoFullName);
		const sentBody = body === undefined ? undefined : JSON.stringify(body);
		const res = await this.fetchImpl(`${this.apiBase}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: sentBody,
		});
		// One text read serves both the byte count and the parse, so metering adds
		// no extra network work. onCall observes only — never let it break a call.
		const text = await res.text();
		try {
			this.options.onCall?.({
				bytesIn: text.length,
				bytesOut: sentBody ? sentBody.length : 0,
			});
		} catch {
			// metering must never fail a forge call
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
	patch(repo: string, path: string, body: unknown): Promise<unknown> {
		return this.request(repo, "PATCH", path, body);
	}
	put(repo: string, path: string, body: unknown): Promise<unknown> {
		return this.request(repo, "PUT", path, body);
	}
}
