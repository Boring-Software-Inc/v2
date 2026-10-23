/**
 * Minimal authenticated GitHub REST client shared by reads and actions.
 * No octokit — the surface Tripwire touches stays small and visible.
 */
export interface GithubHttpOptions {
	tokenFor(repoFullName: string): Promise<string>;
	appId: number;
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
	readonly appId: number;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: GithubHttpOptions) {
		this.apiBase = options.apiBase ?? "https://api.github.com";
		this.appId = options.appId;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async request(
		repoFullName: string,
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<unknown> {
		return (await this.send(repoFullName, method, path, body)).body;
	}

	async getPage(
		repoFullName: string,
		path: string,
	): Promise<{ body: unknown; next: string | null }> {
		const { body, headers } = await this.send(repoFullName, "GET", path);
		const next = nextLink(headers.get("link"));
		return {
			body,
			next:
				next?.startsWith(this.apiBase) === true
					? next.slice(this.apiBase.length)
					: next,
		};
	}

	private async send(
		repoFullName: string,
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<{ body: unknown; headers: Headers }> {
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
			throw new GithubHttpError(
				`${method} ${path} failed: ${res.status} ${text}`,
				res.status,
				isRateLimited(res, text),
			);
		}
		return {
			body: res.status === 204 || text.length === 0 ? null : JSON.parse(text),
			headers: res.headers,
		};
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
	delete(repo: string, path: string): Promise<unknown> {
		return this.request(repo, "DELETE", path);
	}
}

export class GithubHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly rateLimited: boolean,
	) {
		super(message);
		this.name = "GithubHttpError";
	}
}

function isRateLimited(res: Response, text: string): boolean {
	if (res.status === 429) {
		return true;
	}
	return (
		res.status === 403 &&
		(res.headers.get("x-ratelimit-remaining") === "0" ||
			res.headers.has("retry-after") ||
			/rate limit/i.test(text))
	);
}

function nextLink(header: string | null): string | null {
	if (!header) {
		return null;
	}
	for (const part of header.split(",")) {
		const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
		if (match?.[1]) {
			return match[1];
		}
	}
	return null;
}
