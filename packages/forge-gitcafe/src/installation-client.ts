import {
	type GitCafeInstallation,
	type GitCafePermission,
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
} from "@tripwire/contracts";
import {
	createGitCafeInstallationRequest,
	type GitCafeAppCredentials,
	type GitCafeInstallationRequest,
} from "./app-assertion.ts";

export type GitCafeInstallationFailure = {
	ok: false;
	reason:
		| "configuration"
		| "invalid-installation-id"
		| "network"
		| "http"
		| "invalid-response"
		| "identity-mismatch"
		| "inactive"
		| "stale";
	status?: number;
};

export type GitCafeInstallationResult<T> =
	| { ok: true; value: T }
	| GitCafeInstallationFailure;

export interface GitCafeInstallationClientOptions {
	credentials: GitCafeAppCredentials;
	fetch?: (url: string, init: RequestInit) => Promise<Response>;
	now?: () => number;
}

interface CachedToken {
	token: string;
	expiresAt: number;
	scope: string;
}

interface PendingToken {
	scope: string;
	generation: number;
	promise: Promise<GitCafeInstallationResult<string>>;
}

interface InstallationSnapshot {
	installation: GitCafeInstallation;
	generation: number;
}

const TOKEN_SAFETY_MS = 60_000;
const TOKEN_MAX_LIFETIME_MS = 15 * 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PERMISSION_RANK = { read: 1, write: 2, admin: 3 };

export class GitCafeInstallationClient {
	private readonly fetch: NonNullable<
		GitCafeInstallationClientOptions["fetch"]
	>;
	private readonly now: () => number;
	private readonly tokens = new Map<string, CachedToken>();
	private readonly lookups = new Map<
		string,
		Promise<GitCafeInstallationResult<InstallationSnapshot>>
	>();
	private readonly mints = new Map<string, PendingToken>();
	private readonly generations = new Map<string, number>();

	constructor(private readonly options: GitCafeInstallationClientOptions) {
		this.fetch = options.fetch ?? fetch;
		this.now = options.now ?? Date.now;
	}

	/** Invalidated in-flight credentials must never repopulate the cache. */
	invalidate(installationId: string): void {
		this.generations.set(installationId, this.generation(installationId) + 1);
		this.tokens.delete(installationId);
		this.lookups.delete(installationId);
		this.mints.delete(installationId);
	}

	async getInstallation(
		installationId: string,
	): Promise<GitCafeInstallationResult<GitCafeInstallation>> {
		const snapshot = await this.getSnapshot(installationId);
		return snapshot.ok
			? { ok: true, value: snapshot.value.installation }
			: snapshot;
	}

	private getSnapshot(
		installationId: string,
	): Promise<GitCafeInstallationResult<InstallationSnapshot>> {
		if (!/^[A-Za-z0-9_-]+$/.test(installationId)) {
			return Promise.resolve({ ok: false, reason: "invalid-installation-id" });
		}
		const pending = this.lookups.get(installationId);
		if (pending) return pending;
		const generation = this.generation(installationId);
		const lookup = this.lookup(installationId, generation);
		this.lookups.set(installationId, lookup);
		const clear = () => {
			if (this.lookups.get(installationId) === lookup) {
				this.lookups.delete(installationId);
			}
		};
		void lookup.then(clear, clear);
		return lookup;
	}

	async getToken(
		installationId: string,
	): Promise<GitCafeInstallationResult<string>> {
		const lookup = await this.getSnapshot(installationId);
		if (!lookup.ok) return lookup;
		const { installation, generation } = lookup.value;
		if (this.generation(installationId) !== generation) {
			return { ok: false, reason: "stale" };
		}
		if (
			installation.pausedAt !== null ||
			installation.suspendedAt !== null ||
			installation.uninstalledAt !== null
		) {
			return { ok: false, reason: "inactive" };
		}
		const scope = JSON.stringify(installation);
		const cached = this.tokens.get(installationId);
		if (
			cached?.scope === scope &&
			cached.expiresAt - TOKEN_SAFETY_MS > this.now()
		) {
			return { ok: true, value: cached.token };
		}
		const pending = this.mints.get(installationId);
		this.tokens.delete(installationId);
		if (pending?.scope === scope && pending.generation === generation) {
			return pending.promise;
		}
		const promise = this.mint(installation, scope, generation);
		const entry = { scope, generation, promise };
		this.mints.set(installationId, entry);
		try {
			return await promise;
		} finally {
			if (this.mints.get(installationId) === entry) {
				this.mints.delete(installationId);
			}
		}
	}

	private generation(installationId: string): number {
		return this.generations.get(installationId) ?? 0;
	}

	private async lookup(
		installationId: string,
		generation: number,
	): Promise<GitCafeInstallationResult<InstallationSnapshot>> {
		const response = await this.request(installationId, "lookup");
		if (this.generation(installationId) !== generation) {
			return { ok: false, reason: "stale" };
		}
		if (!response.ok) {
			this.invalidate(installationId);
			return response;
		}
		const parsed = gitCafeInstallationSchema.safeParse(response.value);
		if (!parsed.success) {
			this.invalidate(installationId);
			return { ok: false, reason: "invalid-response" };
		}
		if (
			parsed.data.id !== installationId ||
			parsed.data.appId !== this.options.credentials.appId
		) {
			this.invalidate(installationId);
			return { ok: false, reason: "identity-mismatch" };
		}
		const installation = parsed.data;
		const scope = JSON.stringify(installation);
		const cached = this.tokens.get(installationId);
		const pending = this.mints.get(installationId);
		if (
			installation.pausedAt !== null ||
			installation.suspendedAt !== null ||
			installation.uninstalledAt !== null ||
			(cached && cached.scope !== scope) ||
			(pending && pending.scope !== scope)
		) {
			this.invalidate(installationId);
		}
		return {
			ok: true,
			value: { installation, generation: this.generation(installationId) },
		};
	}

	private async mint(
		installation: GitCafeInstallation,
		scope: string,
		generation: number,
	): Promise<GitCafeInstallationResult<string>> {
		const response = await this.request(installation.id, "mint");
		if (this.generation(installation.id) !== generation) {
			return { ok: false, reason: "stale" };
		}
		if (!response.ok) return response;
		const parsed = gitCafeInstallationTokenSchema.safeParse(response.value);
		if (!parsed.success) return { ok: false, reason: "invalid-response" };
		const token = parsed.data;
		if (
			token.installationId !== installation.id ||
			token.actor !== installation.bot.actorId ||
			token.repositorySelection !== installation.repositorySelection ||
			!token.repositories.every((repo) =>
				installation.repositories.includes(repo),
			) ||
			!token.permissions.every((permission) =>
				permissionWithin(permission, installation.permissions),
			)
		) {
			return { ok: false, reason: "identity-mismatch" };
		}
		const expiresAt = Date.parse(token.expiresAt);
		const now = this.now();
		if (
			expiresAt - TOKEN_SAFETY_MS <= now ||
			expiresAt > now + TOKEN_MAX_LIFETIME_MS + TOKEN_SAFETY_MS ||
			token.token === "[REDACTED]"
		) {
			return { ok: false, reason: "invalid-response" };
		}
		this.tokens.set(installation.id, {
			token: token.token,
			expiresAt: Math.min(expiresAt, now + TOKEN_MAX_LIFETIME_MS),
			scope,
		});
		return { ok: true, value: token.token };
	}

	private async request(
		installationId: string,
		operation: "lookup" | "mint",
	): Promise<GitCafeInstallationResult<unknown>> {
		let request: GitCafeInstallationRequest;
		try {
			request = createGitCafeInstallationRequest(
				this.options.credentials,
				installationId,
				operation,
				this.now(),
			);
		} catch {
			return { ok: false, reason: "configuration" };
		}
		let response: Response;
		try {
			response = await this.fetch(request.url, {
				...request.init,
				redirect: "manual",
				signal: AbortSignal.timeout(10_000),
			});
		} catch {
			return { ok: false, reason: "network" };
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			return { ok: false, reason: "http", status: response.status };
		}
		try {
			const reader = response.body?.getReader();
			if (!reader) return { ok: false, reason: "invalid-response" };
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				bytes += next.value.byteLength;
				if (bytes > MAX_RESPONSE_BYTES) {
					await reader.cancel();
					return { ok: false, reason: "invalid-response" };
				}
				chunks.push(next.value);
			}
			const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			return { ok: true, value };
		} catch {
			return { ok: false, reason: "invalid-response" };
		}
	}
}

function permissionWithin(
	requested: GitCafePermission,
	granted: readonly GitCafePermission[],
): boolean {
	return granted.some(
		(permission) =>
			permission.kind === requested.kind &&
			permission.family === requested.family &&
			PERMISSION_RANK[permission.level] >= PERMISSION_RANK[requested.level],
	);
}
