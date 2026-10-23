import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GithubInstallations } from "./installations.ts";

const installationCreated = z
	.object({
		installation: z.object({
			id: z.number(),
			account: z.object({
				id: z.number(),
				login: z.string(),
				type: z.string(),
			}),
		}),
		repositories: z.array(z.object({ id: z.number() }).passthrough()),
	})
	.parse(
		await Bun.file(
			fileURLToPath(
				new URL("../../fixtures/installation.created.json", import.meta.url),
			),
		).json(),
	);

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

function client(respond: (url: string) => Response, seen: string[] = []) {
	return new GithubInstallations({
		credentials: { appId: "1", privateKey },
		fetchImpl: ((input: string | URL | Request) => {
			const url = String(input);
			seen.push(url.replace("https://api.github.com", ""));
			return Promise.resolve(respond(url));
		}) as typeof fetch,
	});
}

function json(status: number, body: string): Response {
	return new Response(body, { status });
}

describe("GithubInstallations", () => {
	test("an installation this app does not own reads as null", async () => {
		const github = client(() =>
			json(404, JSON.stringify({ message: "Not Found" })),
		);
		expect(await github.getInstallation("42")).toBeNull();
	});

	test("other failures throw", async () => {
		const github = client(() => json(500, JSON.stringify({ message: "boom" })));
		await expect(github.getInstallation("42")).rejects.toThrow("500");
	});

	test("an installation reads its account id, login and type", async () => {
		const github = client(() =>
			json(
				200,
				JSON.stringify({
					id: installationCreated.installation.id,
					account: installationCreated.installation.account,
				}),
			),
		);
		expect(
			await github.getInstallation(String(installationCreated.installation.id)),
		).toEqual({
			account: "Boring-Software-Inc",
			accountId: "302335896",
			accountType: "Organization",
		});
	});

	test("user installation repositories carry the admin bit and page until the total", async () => {
		const seen: string[] = [];
		const github = client((url) => {
			const page = Number(new URL(url).searchParams.get("page"));
			const repositories = Array.from(
				{ length: page === 1 ? 100 : 1 },
				(_, i) => ({
					...installationCreated.repositories[0],
					id: page * 1000 + i,
					permissions: {
						admin: i === 0,
						maintain: false,
						push: true,
						triage: true,
						pull: true,
					},
				}),
			);
			return json(
				200,
				JSON.stringify({
					total_count: 101,
					repository_selection: "selected",
					repositories,
				}),
			);
		}, seen);
		const access = await github.userInstallationRepositories("ghu_x", "42");
		expect(access.status).toBe("listed");
		const repos = access.status === "listed" ? access.repositories : [];
		expect(repos).toHaveLength(101);
		expect(repos[0]).toEqual({ externalId: "1000", admin: true });
		expect(repos[1]).toEqual({ externalId: "1001", admin: false });
		expect(seen[0]).toBe(
			"/user/installations/42/repositories?per_page=100&page=1",
		);
		expect(seen).toHaveLength(2);
	});

	test("a repository without permissions is not admin", async () => {
		const github = client(() =>
			json(
				200,
				JSON.stringify({
					total_count: 1,
					repositories: installationCreated.repositories,
				}),
			),
		);
		expect(await github.userInstallationRepositories("ghu_x", "42")).toEqual({
			status: "listed",
			repositories: [{ externalId: "1297742259", admin: false }],
		});
	});

	test("rejected, non-app and unseen installation answers are named", async () => {
		expect(
			await client(() => json(401, "{}")).userInstallationRepositories(
				"ghu_x",
				"42",
			),
		).toEqual({ status: "unauthorized" });
		expect(
			await client(() => json(403, "{}")).userInstallationRepositories(
				"gho_x",
				"42",
			),
		).toEqual({ status: "forbidden" });
		expect(
			await client(() => json(404, "{}")).userInstallationRepositories(
				"ghu_x",
				"42",
			),
		).toEqual({ status: "not-found" });
	});
});
