import { z } from "zod";
import {
	createAppJwt,
	type GithubAppCredentials,
	InstallationTokenCache,
} from "./auth.ts";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

const installationSchema = z.object({
	account: z
		.object({
			id: z.number(),
			login: z.string(),
			type: z.string().optional(),
		})
		.nullable(),
});

const repositoryPageSchema = z.object({
	total_count: z.number().int().nonnegative(),
	repositories: z.array(
		z.object({
			id: z.number(),
			name: z.string(),
			full_name: z.string(),
			private: z.boolean(),
			owner: z.object({ login: z.string() }),
		}),
	),
});

const userInstallationRepositoryPageSchema = z.object({
	total_count: z.number().int().nonnegative(),
	repositories: z.array(
		z.object({
			id: z.number(),
			permissions: z.object({ admin: z.boolean() }).optional(),
		}),
	),
});

export interface GithubInstallation {
	account: string;
	accountId: string | null;
	accountType: "User" | "Organization" | undefined;
}

export interface GithubInstallationRepo {
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
}

export interface UserInstallationRepo {
	externalId: string;
	admin: boolean;
}

export type UserInstallationAccess =
	| { status: "listed"; repositories: UserInstallationRepo[] }
	| { status: "not-found" }
	| { status: "unauthorized" }
	| { status: "forbidden" };

export interface GithubInstallationsOptions {
	credentials: GithubAppCredentials;
	apiBase?: string;
	fetchImpl?: typeof fetch;
}

function accountType(
	type: string | undefined,
): GithubInstallation["accountType"] {
	if (type === "User" || type === "Organization") {
		return type;
	}
	return undefined;
}

export class GithubInstallations {
	private readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;
	private readonly tokens: InstallationTokenCache;

	constructor(private readonly options: GithubInstallationsOptions) {
		this.apiBase = options.apiBase ?? "https://api.github.com";
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.tokens = new InstallationTokenCache(
			options.credentials,
			this.apiBase,
			this.fetchImpl,
		);
	}

	private get(path: string, token: string): Promise<Response> {
		return this.fetchImpl(`${this.apiBase}${path}`, {
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
			},
		});
	}

	async getInstallation(
		installationId: string,
	): Promise<GithubInstallation | null> {
		const res = await this.get(
			`/app/installations/${encodeURIComponent(installationId)}`,
			createAppJwt(this.options.credentials),
		);
		if (res.status === 404) {
			return null;
		}
		if (!res.ok) {
			throw new Error(
				`GET /app/installations/${installationId} failed: ${res.status}`,
			);
		}
		const parsed = installationSchema.parse(await res.json());
		return {
			account: parsed.account?.login ?? "",
			accountId: parsed.account ? String(parsed.account.id) : null,
			accountType: accountType(parsed.account?.type),
		};
	}

	async listRepositories(
		installationId: string,
	): Promise<GithubInstallationRepo[]> {
		const token = await this.tokens.getToken(installationId);
		const found: GithubInstallationRepo[] = [];
		let totalCount: number | undefined;
		const seen = new Set<number>();
		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await this.get(
				`/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
				token,
			);
			if (!res.ok) {
				throw new Error(`GET /installation/repositories failed: ${res.status}`);
			}
			const body = repositoryPageSchema.parse(await res.json());
			if (totalCount !== undefined && totalCount !== body.total_count) {
				throw new Error(
					"installation repository count changed during pagination",
				);
			}
			totalCount = body.total_count;
			for (const repo of body.repositories) {
				if (seen.has(repo.id)) {
					throw new Error("installation repository repeated during pagination");
				}
				seen.add(repo.id);
				found.push({
					externalId: String(repo.id),
					owner: repo.owner.login,
					name: repo.name,
					fullName: repo.full_name,
					private: repo.private,
				});
			}
			if (
				body.repositories.length < PAGE_SIZE ||
				found.length >= body.total_count
			) {
				break;
			}
		}
		if (totalCount !== undefined && found.length !== totalCount) {
			throw new Error(
				`installation repositories truncated: fetched ${found.length} of ${totalCount} (page cap ${MAX_PAGES} x ${PAGE_SIZE})`,
			);
		}
		return found;
	}

	async userInstallationRepositories(
		userToken: string,
		installationId: string,
	): Promise<UserInstallationAccess> {
		const repositories: UserInstallationRepo[] = [];
		const path = `/user/installations/${encodeURIComponent(installationId)}/repositories`;
		let totalCount: number | undefined;
		const seen = new Set<number>();
		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await this.get(
				`${path}?per_page=${PAGE_SIZE}&page=${page}`,
				userToken,
			);
			if (res.status === 401) {
				return { status: "unauthorized" };
			}
			if (res.status === 403) {
				return { status: "forbidden" };
			}
			if (res.status === 404) {
				return { status: "not-found" };
			}
			if (!res.ok) {
				throw new Error(
					`GET /user/installations/${installationId}/repositories failed: ${res.status}`,
				);
			}
			const body = userInstallationRepositoryPageSchema.parse(await res.json());
			if (totalCount !== undefined && totalCount !== body.total_count) {
				throw new Error(
					"installation repository count changed during pagination",
				);
			}
			totalCount = body.total_count;
			for (const repo of body.repositories) {
				if (seen.has(repo.id)) {
					throw new Error("installation repository repeated during pagination");
				}
				seen.add(repo.id);
				repositories.push({
					externalId: String(repo.id),
					admin: repo.permissions?.admin === true,
				});
			}
			if (
				body.repositories.length < PAGE_SIZE ||
				repositories.length >= body.total_count
			) {
				break;
			}
		}
		if (totalCount !== undefined && repositories.length !== totalCount) {
			throw new Error(
				`user installation repositories truncated: fetched ${repositories.length} of ${totalCount} (page cap ${MAX_PAGES} x ${PAGE_SIZE})`,
			);
		}
		return { status: "listed", repositories };
	}
}
