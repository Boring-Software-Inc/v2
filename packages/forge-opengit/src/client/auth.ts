import { createSign } from "node:crypto";

/**
 * open-git bot auth: a short-lived RS256 bot JWT mints one-hour `ogi_`
 * installation tokens, cached until shortly before expiry. Same shape as the
 * GitHub App flow, deliberately re-derived rather than shared — adapters are
 * siblings and never import each other (§3).
 *
 * open-git verifies the JWT with `iss` = the bot id, RS256 against the SPKI
 * public key registered on the bot, and a max age of 10 minutes.
 */

export interface OpenGitBotCredentials {
	/** The bot id, which open-git requires as the JWT issuer. */
	botId: string;
	/** PEM-encoded private key (PKCS#1 or PKCS#8). */
	privateKey: string;
}

function b64url(input: string | Buffer): string {
	return Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * Bot JWT. open-git enforces `maxTokenAge: "10m"` against `iat`, so the window
 * is nine minutes rather than GitHub's ten — a minute of clock skew headroom
 * that keeps a slightly-fast worker from minting a token open-git reads as
 * already expired.
 */
export function createBotJwt(
	creds: OpenGitBotCredentials,
	now = Date.now(),
): string {
	const iat = Math.floor(now / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = b64url(
		JSON.stringify({ iat, exp: iat + 540, iss: creds.botId }),
	);
	const signature = createSign("RSA-SHA256")
		.update(`${header}.${payload}`)
		.sign(creds.privateKey);
	return `${header}.${payload}.${b64url(signature)}`;
}

export const OPEN_GIT_API_BASE = "https://open-git.com";

interface CachedToken {
	token: string;
	expiresAt: number;
}

const TOKEN_SAFETY_MS = 60_000;

export class OpenGitTokenCache {
	private readonly cache = new Map<string, CachedToken>();

	constructor(
		private readonly creds: OpenGitBotCredentials,
		private readonly apiBase = OPEN_GIT_API_BASE,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async getToken(installationId: string): Promise<string> {
		const cached = this.cache.get(installationId);
		if (cached && cached.expiresAt - TOKEN_SAFETY_MS > Date.now()) {
			return cached.token;
		}
		// No `permissions` body: omitting it asks for everything the installation
		// was granted, which is what the worker needs and avoids pinning this
		// client to open-git's permission vocabulary.
		const res = await this.fetchImpl(
			`${this.apiBase}/api/v1/app/installations/${installationId}/access_tokens`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${createBotJwt(this.creds)}`,
					accept: "application/json",
				},
			},
		);
		if (!res.ok) {
			throw new Error(
				`installation token request failed: ${res.status} ${await res.text()}`,
			);
		}
		const data = (await res.json()) as { token: string; expires_at: string };
		this.cache.set(installationId, {
			token: data.token,
			expiresAt: new Date(data.expires_at).getTime(),
		});
		return data.token;
	}
}
