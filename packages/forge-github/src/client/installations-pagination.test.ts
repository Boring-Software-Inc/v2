import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { GithubInstallations } from "./installations.ts";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const CAP = PAGE_SIZE * MAX_PAGES;

function client(respond: (url: string) => Response) {
	return new GithubInstallations({
		credentials: { appId: "1", privateKey },
		fetchImpl: ((input: string | URL | Request) =>
			Promise.resolve(respond(String(input)))) as typeof fetch,
	});
}

function repoPage(totalCount: number, page: number, perPage: number) {
	const offset = (page - 1) * perPage;
	const remaining = totalCount - offset;
	const count = Math.min(perPage, Math.max(0, remaining));
	const repositories = Array.from({ length: count }, (_, i) => ({
		id: offset + i + 1,
		name: `repo-${offset + i + 1}`,
		full_name: `org/repo-${offset + i + 1}`,
		private: true,
		owner: { login: "org" },
		permissions: { admin: true },
	}));
	return new Response(
		JSON.stringify({ total_count: totalCount, repositories }),
		{
			status: 200,
		},
	);
}

function paginatedClient(totalCount: number) {
	return client((url) => {
		const params = new URL(url);
		const page = Number(params.searchParams.get("page"));
		const perPage = Number(params.searchParams.get("per_page"));
		return repoPage(totalCount, page, perPage);
	});
}

describe("GithubInstallations pagination truncation", () => {
	test("listRepositories throws when total_count exceeds the page cap", async () => {
		const github = paginatedClient(CAP + 1000);
		await expect(github.listRepositories("42")).rejects.toThrow(
			"installation repositories truncated: fetched 5000 of 6000",
		);
	});

	test("userInstallationRepositories throws when total_count exceeds the page cap", async () => {
		const github = paginatedClient(CAP + 1000);
		await expect(
			github.userInstallationRepositories("ghu_x", "42"),
		).rejects.toThrow(
			"user installation repositories truncated: fetched 5000 of 6000",
		);
	});

	test("listRepositories throws when total_count is one over the cap", async () => {
		const github = paginatedClient(CAP + 1);
		await expect(github.listRepositories("42")).rejects.toThrow(
			"installation repositories truncated: fetched 5000 of 5001",
		);
	});

	test("userInstallationRepositories throws when total_count is one over the cap", async () => {
		const github = paginatedClient(CAP + 1);
		await expect(
			github.userInstallationRepositories("ghu_x", "42"),
		).rejects.toThrow(
			"user installation repositories truncated: fetched 5000 of 5001",
		);
	});

	test("listRepositories does not throw at the exact cap", async () => {
		const github = paginatedClient(CAP);
		const repos = await github.listRepositories("42");
		expect(repos).toHaveLength(CAP);
		expect(repos[0]?.externalId).toBe("1");
		expect(repos[CAP - 1]?.externalId).toBe(String(CAP));
	});

	test("userInstallationRepositories does not throw at the exact cap", async () => {
		const github = paginatedClient(CAP);
		const access = await github.userInstallationRepositories("ghu_x", "42");
		expect(access.status).toBe("listed");
		if (access.status === "listed") {
			expect(access.repositories).toHaveLength(CAP);
			expect(access.repositories[0]).toEqual({
				externalId: "1",
				admin: true,
			});
		}
	});
	test("rejects repeated repository IDs across pages", async () => {
		const github = client((url) =>
			new URL(url).pathname.endsWith("/access_tokens")
				? new Response(
						JSON.stringify({
							token: "ghs_x",
							expires_at: "2099-01-01T00:00:00Z",
						}),
						{ status: 201 },
					)
				: repoPage(200, 1, PAGE_SIZE),
		);
		await expect(github.listRepositories("42")).rejects.toThrow(
			"repository repeated",
		);
	});

	test("rejects a total that changes during a user repository read", async () => {
		const github = client((url) => {
			const page = Number(new URL(url).searchParams.get("page"));
			return repoPage(page === 1 ? 200 : 199, page, PAGE_SIZE);
		});
		await expect(
			github.userInstallationRepositories("ghu_x", "42"),
		).rejects.toThrow("repository count changed");
	});
});
