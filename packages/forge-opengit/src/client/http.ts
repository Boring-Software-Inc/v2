import type { JsonValue } from "@tripwire/contracts";
import { OPEN_GIT_API_BASE } from "./auth.ts";

/**
 * Minimal authenticated open-git v1 client. The surface Tripwire touches is
 * one endpoint wide today (checks), so this stays deliberately small.
 */
export interface OpenGitHttpOptions {
	tokenFor(repoFullName: string): Promise<string>;
	apiBase?: string;
	fetchImpl?: typeof fetch;
	/**
	 * Best-effort metering hook, called once per request with the request and
	 * response body sizes. Observes only; a throw here must never break a call.
	 */
	onCall?: (bytes: { bytesIn: number; bytesOut: number }) => void;
}

export class OpenGitHttp {
	readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: OpenGitHttpOptions) {
		this.apiBase = options.apiBase ?? OPEN_GIT_API_BASE;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async request(
		repoFullName: string,
		method: "GET" | "POST" | "PATCH" | "PUT",
		path: string,
		body?: JsonValue,
	): Promise<unknown> {
		const token = await this.options.tokenFor(repoFullName);
		const sentBody = body === undefined ? undefined : JSON.stringify(body);
		// Built as a statement: a content-type on a bodyless GET is a lie, and a
		// conditional spread hides that decision inside the object literal.
		const headers = new Headers({
			authorization: `Bearer ${token}`,
			accept: "application/json",
		});
		if (sentBody !== undefined) {
			headers.set("content-type", "application/json");
		}
		const res = await this.fetchImpl(`${this.apiBase}${path}`, {
			method,
			headers,
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
	post(repo: string, path: string, body: JsonValue): Promise<unknown> {
		return this.request(repo, "POST", path, body);
	}
}
