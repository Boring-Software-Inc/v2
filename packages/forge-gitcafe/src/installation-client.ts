import {
	type GitCafeConnectionRepository,
	type GitCafeInstallation,
	type GitCafeInstallationFailureReason,
	type GitCafeOrganizationMembers,
	type GitCafePermission,
	gitCafeConnectionRepositoryPageSchema,
	gitCafeConnectionRepositorySchema,
	gitCafeInstallationSchema,
	gitCafeInstallationTokenSchema,
	gitCafeOrganizationMembersSchema,
} from "@tripwire/contracts";
import {
	createGitCafeInstallationRequest,
	type GitCafeAppCredentials,
	type GitCafeInstallationRequest,
} from "./app-assertion.ts";

export type GitCafeInstallationFailure = {
	ok: false;
	reason: GitCafeInstallationFailureReason;
	status?: number;
};

export type GitCafeInstallationResult<T> =
	| { ok: true; value: T }
	| GitCafeInstallationFailure;

export interface GitCafeInstallationClientOptions {
	credentials: GitCafeAppCredentials;
	fetch?: (url: string, init: RequestInit) => Promise<Response>;
	now?: () => number;
	/** Local persisted lifecycle authority is checked before credentials and token use. */
	lifecycleGuard?: (installationId: string) => Promise<boolean>;
}

export type GitCafeReadResource =
	| { kind: "pull"; number: number }
	| {
			kind: "changes" | "commits";
			number: number;
			version: number;
			after?: string;
	  }
	| { kind: "diff-file"; number: number; version: number; path: string }
	| { kind: "blob"; oid: string; path: string }
	| { kind: "profile"; login: string }
	| { kind: "members" | "collaborators"; after?: string }
	| { kind: "merged-pulls"; after?: string };

export interface GitCafeAuthorizedJsonRequest {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	resourcePath: string;
	/** The typed caller validates its contracts payload before serialization. */
	body?: string;
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
const PATH_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

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
	private readonly snapshots = new WeakMap<
		GitCafeInstallation,
		{
			scope: string;
			generation: number;
		}
	>();

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
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<GitCafeInstallation>> {
		const snapshot = await this.getSnapshot(installationId, deadlineAt);
		if (snapshot.ok) {
			this.snapshots.set(snapshot.value.installation, {
				scope: JSON.stringify(snapshot.value.installation),
				generation: snapshot.value.generation,
			});
		}
		return snapshot.ok
			? { ok: true, value: snapshot.value.installation }
			: snapshot;
	}

	/** Expected authority must come from this client's installation lookup. */
	async getOrganizationMembers(
		installationId: string,
		org: string,
		expectedInstallation?: GitCafeInstallation,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<GitCafeOrganizationMembers>> {
		if (!PATH_SEGMENT.test(org))
			return { ok: false, reason: "invalid-resource-path" };
		if (expectedInstallation && expectedInstallation.org !== org)
			return { ok: false, reason: "identity-mismatch" };
		const authority = expectedInstallation
			? { ok: true as const, value: expectedInstallation }
			: await this.getInstallation(installationId, deadlineAt);
		if (!authority.ok) return authority;
		if (authority.value.org !== org)
			return { ok: false, reason: "identity-mismatch" };
		const items: GitCafeOrganizationMembers["items"] = [];
		const actors = new Set<string>();
		const cursors = new Set<string>();
		let after: string | null = null;
		do {
			const query = after === null ? "" : `?after=${encodeURIComponent(after)}`;
			const response = await this.installedRequest(
				installationId,
				`orgs/${encodeURIComponent(org)}/members/${query}`,
				authority.value,
				deadlineAt,
			);
			if (!response.ok) return response;
			const parsed = gitCafeOrganizationMembersSchema.safeParse(response.value);
			if (!parsed.success || parsed.data.items.length > 100)
				return { ok: false, reason: "invalid-response" };
			const page = parsed.data;
			if (
				page.next !== null &&
				(page.items.length === 0 || cursors.has(page.next))
			)
				return { ok: false, reason: "invalid-response" };
			for (const member of page.items) {
				if (actors.has(member.actorId))
					return { ok: false, reason: "invalid-response" };
				actors.add(member.actorId);
				items.push(member);
			}
			after = page.next;
			if (after !== null) cursors.add(after);
		} while (after !== null);
		items.sort((a, b) =>
			a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0,
		);
		if (this.expired(deadlineAt)) return { ok: false, reason: "expired" };
		return { ok: true, value: { items, next: null } };
	}

	/** Complete installed scope is required before ownership can be committed. */
	async getRepositories(
		installationId: string,
		owner: string,
		expectedInstallation: GitCafeInstallation,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<GitCafeConnectionRepository[]>> {
		if (!PATH_SEGMENT.test(owner))
			return { ok: false, reason: "invalid-resource-path" };
		if (expectedInstallation.org !== owner)
			return { ok: false, reason: "identity-mismatch" };
		const repositories: GitCafeConnectionRepository[] = [];
		const ids = new Set<string>();
		const names = new Set<string>();
		const selected = new Set(expectedInstallation.repositories);
		const cursors = new Set<string>();
		let after: string | null = null;
		do {
			const query = new URLSearchParams({ owner, sort: "id", limit: "50" });
			if (after !== null) query.set("after", after);
			const response = await this.installedRequest(
				installationId,
				`repos?${query}`,
				expectedInstallation,
				deadlineAt,
			);
			if (!response.ok) return response;
			const parsed = gitCafeConnectionRepositoryPageSchema.safeParse(
				response.value,
			);
			if (!parsed.success) return { ok: false, reason: "invalid-response" };
			const page = parsed.data;
			if (
				page.next !== null &&
				(page.items.length === 0 || cursors.has(page.next))
			)
				return { ok: false, reason: "invalid-response" };
			for (const repo of page.items) {
				if (
					repo.owner !== owner ||
					!PATH_SEGMENT.test(repo.name) ||
					ids.has(repo.id) ||
					names.has(repo.name) ||
					(expectedInstallation.repositorySelection === "selected" &&
						!selected.has(repo.name))
				)
					return { ok: false, reason: "identity-mismatch" };
				ids.add(repo.id);
				names.add(repo.name);
				repositories.push(repo);
			}
			after = page.next;
			if (after !== null) cursors.add(after);
		} while (after !== null);
		if (
			expectedInstallation.repositorySelection === "selected" &&
			(selected.size !== expectedInstallation.repositories.length ||
				names.size !== selected.size)
		)
			return { ok: false, reason: "identity-mismatch" };
		repositories.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		if (this.expired(deadlineAt)) return { ok: false, reason: "expired" };
		return { ok: true, value: repositories };
	}

	async getRepository(
		installationId: string,
		owner: string,
		name: string,
		expectedInstallation?: GitCafeInstallation,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<GitCafeConnectionRepository>> {
		if (!PATH_SEGMENT.test(owner) || !PATH_SEGMENT.test(name))
			return { ok: false, reason: "invalid-resource-path" };
		if (
			expectedInstallation &&
			(expectedInstallation.org !== owner ||
				(expectedInstallation.repositorySelection === "selected" &&
					!expectedInstallation.repositories.includes(name)))
		)
			return { ok: false, reason: "identity-mismatch" };
		const response = await this.installedRequest(
			installationId,
			`repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
			expectedInstallation,
			deadlineAt,
		);
		if (!response.ok) return response;
		const parsed = gitCafeConnectionRepositorySchema.safeParse(response.value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: { ok: false, reason: "invalid-response" };
	}

	async readResource(
		installationId: string,
		repoFullName: string,
		resource: GitCafeReadResource,
	): Promise<GitCafeInstallationResult<unknown>> {
		if (!this.options.lifecycleGuard)
			return { ok: false, reason: "configuration" };
		const parts = repoFullName.split("/");
		const [owner, repo] = parts;
		if (
			parts.length !== 2 ||
			!owner ||
			!repo ||
			owner.length > 39 ||
			repo.length > 104 ||
			!PATH_SEGMENT.test(owner) ||
			!PATH_SEGMENT.test(repo)
		)
			return { ok: false, reason: "invalid-resource-path" };
		const query = new URLSearchParams();
		let path = `repos/${owner}/${repo}`;
		if ("number" in resource) {
			if (
				!Number.isSafeInteger(resource.number) ||
				resource.number < 1 ||
				resource.number > 2147483647
			)
				return { ok: false, reason: "invalid-resource-path" };
			path += `/pulls/${resource.number}`;
			if (resource.kind !== "pull") {
				if (!Number.isSafeInteger(resource.version) || resource.version < 0)
					return { ok: false, reason: "invalid-resource-path" };
				query.set("expectedVersion", String(resource.version));
				path += `/${resource.kind}`;
			}
		}
		if ("after" in resource && resource.after !== undefined) {
			if (!/^[A-Za-z0-9_-]{1,8192}$/.test(resource.after))
				return { ok: false, reason: "invalid-resource-path" };
			query.set("after", resource.after);
		}
		if ("path" in resource) {
			if (
				!resource.path ||
				resource.path.length > 4096 ||
				resource.path.startsWith("/") ||
				resource.path.includes("\\") ||
				resource.path.includes("\0") ||
				resource.path
					.split("/")
					.some((part) => !part || part === "." || part === "..")
			)
				return { ok: false, reason: "invalid-resource-path" };
			query.set("path", resource.path);
		}
		switch (resource.kind) {
			case "blob":
				if (!/^[0-9a-f]{40}$/.test(resource.oid))
					return { ok: false, reason: "invalid-resource-path" };
				path += "/blob";
				query.set("oid", resource.oid);
				break;
			case "profile":
				if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,99}$/.test(resource.login))
					return { ok: false, reason: "invalid-resource-path" };
				path = `users/${resource.login}`;
				break;
			case "members":
				path = `orgs/${owner}/members/`;
				query.set("limit", "100");
				break;
			case "collaborators":
				path += "/collaborators/";
				query.set("limit", "50");
				break;
			case "merged-pulls":
				path += "/pulls/";
				query.set("state", "merged");
				query.set("limit", "100");
				break;
			case "changes":
				query.set("limit", "500");
				break;
			case "commits":
				query.set("limit", "100");
				break;
			case "pull":
			case "diff-file":
				break;
		}
		const authority = await this.getInstallation(installationId);
		if (!authority.ok) return authority;
		if (
			authority.value.org !== owner ||
			(authority.value.repositorySelection === "selected" &&
				!authority.value.repositories.includes(repo))
		)
			return { ok: false, reason: "identity-mismatch" };
		return this.request(
			installationId,
			{
				method: "GET",
				resourcePath: `${path}${query.size ? `?${query}` : ""}`,
			},
			authority.value,
		);
	}

	async request(
		installationId: string,
		request: GitCafeAuthorizedJsonRequest,
		expectedInstallation: GitCafeInstallation,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<unknown>> {
		if (!this.options.lifecycleGuard)
			return { ok: false, reason: "configuration" };
		if (
			!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
			(request.method === "GET" && request.body !== undefined)
		)
			return { ok: false, reason: "configuration" };
		const rawPath = request.resourcePath.split("?")[0];
		if (
			!rawPath ||
			rawPath.startsWith("/") ||
			request.resourcePath.includes("#") ||
			request.resourcePath.includes("\\") ||
			Array.from(request.resourcePath).some(
				(char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
			)
		)
			return { ok: false, reason: "invalid-resource-path" };
		let segments: string[];
		try {
			segments = rawPath.replace(/\/$/, "").split("/").map(decodeURIComponent);
		} catch {
			return { ok: false, reason: "invalid-resource-path" };
		}
		if (
			segments.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".." ||
					segment.includes("/") ||
					segment.includes("\\") ||
					Array.from(segment).some(
						(char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
					),
			)
		)
			return { ok: false, reason: "invalid-resource-path" };
		const [kind, owner, repo] = segments;
		if (kind === "repos") {
			if (
				!owner ||
				!repo ||
				owner.length > 39 ||
				repo.length > 104 ||
				!PATH_SEGMENT.test(owner) ||
				!PATH_SEGMENT.test(repo) ||
				owner !== expectedInstallation.org ||
				(expectedInstallation.repositorySelection === "selected" &&
					!expectedInstallation.repositories.includes(repo))
			)
				return { ok: false, reason: "identity-mismatch" };
		} else if (
			request.method !== "GET" ||
			!(
				(kind === "orgs" &&
					owner === expectedInstallation.org &&
					repo === "members" &&
					segments.length === 3) ||
				(kind === "users" &&
					owner &&
					/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,99}$/.test(owner) &&
					segments.length === 2)
			)
		)
			return { ok: false, reason: "invalid-resource-path" };
		return this.installedRequest(
			installationId,
			request.resourcePath,
			expectedInstallation,
			deadlineAt,
			request,
		);
	}

	private async permitted(installationId: string): Promise<boolean> {
		try {
			if (!this.options.lifecycleGuard) return true;
			const active =
				(await this.options.lifecycleGuard(installationId)) === true;
			if (!active) this.invalidate(installationId);
			return active;
		} catch {
			this.invalidate(installationId);
			return false;
		}
	}

	private async installedRequest(
		installationId: string,
		path: string,
		expectedInstallation?: GitCafeInstallation,
		deadlineAt?: number,
		request?: GitCafeAuthorizedJsonRequest,
	): Promise<GitCafeInstallationResult<unknown>> {
		if (this.options.lifecycleGuard && !(await this.permitted(installationId)))
			return { ok: false, reason: "inactive" };
		const generation = this.generation(installationId);
		const credential = await this.getToken(
			installationId,
			expectedInstallation,
			deadlineAt,
		);
		if (!credential.ok) return credential;
		if (this.options.lifecycleGuard && !(await this.permitted(installationId)))
			return { ok: false, reason: "inactive" };
		if (this.generation(installationId) !== generation)
			return { ok: false, reason: "stale" };
		const headers = new Headers({
			accept: "application/json",
			authorization: `Bearer ${credential.value}`,
		});
		if (request?.body !== undefined)
			headers.set("content-type", "application/json");
		const response = await this.send(
			{
				url: `https://git.cafe/api/${path}`,
				init: {
					method: request?.method ?? "GET",
					headers,
					body: request?.body,
				},
			},
			deadlineAt,
		);
		if (this.options.lifecycleGuard && !(await this.permitted(installationId)))
			return { ok: false, reason: "inactive" };
		return this.generation(installationId) === generation
			? response
			: { ok: false, reason: "stale" };
	}

	private async getSnapshot(
		installationId: string,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<InstallationSnapshot>> {
		if (this.expired(deadlineAt))
			return Promise.resolve({ ok: false, reason: "expired" });
		if (!/^[A-Za-z0-9_-]+$/.test(installationId)) {
			return Promise.resolve({ ok: false, reason: "invalid-installation-id" });
		}
		const generation = this.generation(installationId);
		if (this.options.lifecycleGuard && !(await this.permitted(installationId)))
			return { ok: false, reason: "inactive" };
		if (generation !== this.generation(installationId))
			return { ok: false, reason: "stale" };
		const pending = this.lookups.get(installationId);
		if (pending) return this.withDeadline(pending, deadlineAt);
		const lookup = this.lookup(installationId, generation, deadlineAt);
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
		expectedInstallation?: GitCafeInstallation,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<string>> {
		if (this.expired(deadlineAt)) return { ok: false, reason: "expired" };
		const expectedScope = expectedInstallation
			? JSON.stringify(expectedInstallation)
			: undefined;
		const expected = expectedInstallation
			? this.snapshots.get(expectedInstallation)
			: undefined;
		if (
			expectedInstallation &&
			(expectedInstallation.id !== installationId ||
				!expected ||
				expected.scope !== expectedScope ||
				expected.generation !== this.generation(installationId))
		)
			return { ok: false, reason: "stale" };
		const lookup = await this.getSnapshot(installationId, deadlineAt);
		if (!lookup.ok) return lookup;
		const { installation, generation } = lookup.value;
		if (
			this.generation(installationId) !== generation ||
			(expected &&
				(expected.generation !== generation ||
					expectedScope !== JSON.stringify(installation)))
		) {
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
			return this.withDeadline(pending.promise, deadlineAt);
		}
		const promise = this.mint(installation, scope, generation, deadlineAt);
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

	generation(installationId: string): number {
		return this.generations.get(installationId) ?? 0;
	}

	private expired(deadlineAt?: number): boolean {
		return (
			deadlineAt !== undefined &&
			(!Number.isSafeInteger(deadlineAt) || deadlineAt <= this.now())
		);
	}

	private async withDeadline<T>(
		promise: Promise<GitCafeInstallationResult<T>>,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<T>> {
		if (deadlineAt === undefined) return promise;
		if (this.expired(deadlineAt)) return { ok: false, reason: "expired" };
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([
				promise,
				new Promise<GitCafeInstallationFailure>((resolve) => {
					timer = setTimeout(
						() => resolve({ ok: false, reason: "expired" }),
						deadlineAt - this.now(),
					);
				}),
			]);
			return this.expired(deadlineAt)
				? { ok: false, reason: "expired" }
				: result;
		} finally {
			clearTimeout(timer);
		}
	}

	private async lookup(
		installationId: string,
		generation: number,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<InstallationSnapshot>> {
		const response = await this.requestInstallation(
			installationId,
			"lookup",
			deadlineAt,
		);
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
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<string>> {
		const response = await this.requestInstallation(
			installation.id,
			"mint",
			deadlineAt,
		);
		if (this.generation(installation.id) !== generation) {
			return { ok: false, reason: "stale" };
		}
		if (!response.ok) return response;
		const parsed = gitCafeInstallationTokenSchema.safeParse(response.value);
		if (!parsed.success) return { ok: false, reason: "invalid-response" };
		const token = parsed.data;
		const allowedRepositories = new Set(installation.repositories);
		if (
			token.installationId !== installation.id ||
			token.actor !== installation.bot.actorId ||
			token.repositorySelection !== installation.repositorySelection ||
			!token.repositories.every((repo) => allowedRepositories.has(repo)) ||
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

	private async requestInstallation(
		installationId: string,
		operation: "lookup" | "mint",
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<unknown>> {
		if (this.options.lifecycleGuard && !(await this.permitted(installationId)))
			return { ok: false, reason: "inactive" };
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
		const response = await this.send(request, deadlineAt);
		return (await this.permitted(installationId))
			? response
			: { ok: false, reason: "inactive" };
	}

	private async send(
		request: GitCafeInstallationRequest,
		deadlineAt?: number,
	): Promise<GitCafeInstallationResult<unknown>> {
		if (this.expired(deadlineAt)) return { ok: false, reason: "expired" };
		const remaining =
			deadlineAt === undefined ? Infinity : deadlineAt - this.now();
		const deadlineLimited = remaining <= 10_000;
		const signal = AbortSignal.timeout(
			Math.max(1, Math.min(10_000, remaining)),
		);
		let cancelBody: (() => Promise<void>) | undefined;
		let onAbort = () => {};
		const aborted = new Promise<GitCafeInstallationFailure>((resolve) => {
			onAbort = () => {
				void cancelBody?.().catch(() => {});
				resolve({ ok: false, reason: deadlineLimited ? "expired" : "network" });
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});
		const read = async (): Promise<GitCafeInstallationResult<unknown>> => {
			let response: Response;
			try {
				response = await this.fetch(request.url, {
					...request.init,
					redirect: "manual",
					signal,
				});
			} catch {
				return {
					ok: false,
					reason: this.expired(deadlineAt) ? "expired" : "network",
				};
			}
			if (signal.aborted || this.expired(deadlineAt)) {
				await response.body?.cancel().catch(() => {});
				return {
					ok: false,
					reason:
						deadlineLimited || this.expired(deadlineAt) ? "expired" : "network",
				};
			}
			if (!response.ok) {
				await response.body?.cancel().catch(() => {});
				return { ok: false, reason: "http", status: response.status };
			}
			if (response.status === 204) return { ok: true, value: null };
			if (!response.headers.get("content-type")?.includes("application/json")) {
				await response.body?.cancel().catch(() => {});
				return { ok: false, reason: "invalid-response" };
			}
			try {
				const reader = response.body?.getReader();
				if (!reader) return { ok: false, reason: "invalid-response" };
				cancelBody = () => reader.cancel();
				const chunks: Uint8Array[] = [];
				let bytes = 0;
				while (true) {
					const next = await reader.read();
					if (this.expired(deadlineAt)) {
						await reader.cancel().catch(() => {});
						return { ok: false, reason: "expired" };
					}
					if (next.done) break;
					bytes += next.value.byteLength;
					if (bytes > MAX_RESPONSE_BYTES) {
						await reader.cancel();
						return { ok: false, reason: "invalid-response" };
					}
					chunks.push(next.value);
				}
				const value: unknown = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				);
				return { ok: true, value };
			} catch {
				return {
					ok: false,
					reason: this.expired(deadlineAt) ? "expired" : "invalid-response",
				};
			}
		};
		try {
			return await Promise.race([read(), aborted]);
		} finally {
			signal.removeEventListener("abort", onAbort);
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
