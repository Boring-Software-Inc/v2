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
			login: z.string(),
			type: z.string().optional(),
		})
		.nullable(),
});

const repositoryPageSchema = z.object({
	total_count: z.number(),
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

const userInstallationPageSchema = z.object({
	total_count: z.number(),
	installations: z.array(z.object({ id: z.number() })),
});

export interface GithubInstallation {
	account: string;
	accountType: "User" | "Organization" | undefined;
}

export interface GithubInstallationRepo {
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
}

export type UserInstallationAccess =
	| { status: "listed"; installationIds: string[] }
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
			accountType: accountType(parsed.account?.type),
		};
	}

	async listRepositories(
		installationId: string,
	): Promise<GithubInstallationRepo[]> {
		const token = await this.tokens.getToken(installationId);
		const found: GithubInstallationRepo[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await this.get(
				`/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
				token,
			);
			if (!res.ok) {
				throw new Error(`GET /installation/repositories failed: ${res.status}`);
			}
			const body = repositoryPageSchema.parse(await res.json());
			for (const repo of body.repositories) {
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
		return found;
	}

	async userInstallations(userToken: string): Promise<UserInstallationAccess> {
		const installationIds: string[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await this.get(
				`/user/installations?per_page=${PAGE_SIZE}&page=${page}`,
				userToken,
			);
			if (res.status === 401) {
				return { status: "unauthorized" };
			}
			if (res.status === 403) {
				return { status: "forbidden" };
			}
			if (!res.ok) {
				throw new Error(`GET /user/installations failed: ${res.status}`);
			}
			const body = userInstallationPageSchema.parse(await res.json());
			for (const installation of body.installations) {
				installationIds.push(String(installation.id));
			}
			if (
				body.installations.length < PAGE_SIZE ||
				installationIds.length >= body.total_count
			) {
				break;
			}
		}
		return { status: "listed", installationIds };
	}
}
