import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { GithubInstallations } from "./installations.ts";

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

	test("user installations page until the total is reached", async () => {
		const seen: string[] = [];
		const github = client((url) => {
			const page = Number(new URL(url).searchParams.get("page"));
			const ids = Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({
				id: page * 1000 + i,
			}));
			return json(
				200,
				JSON.stringify({ total_count: 101, installations: ids }),
			);
		}, seen);
		const access = await github.userInstallations("ghu_x");
		expect(access.status).toBe("listed");
		expect(access.status === "listed" && access.installationIds).toContain(
			"2000",
		);
		expect(seen).toHaveLength(2);
	});

	test("a rejected user token is unauthorized, a non-app token is forbidden", async () => {
		expect(
			await client(() => json(401, "{}")).userInstallations("ghu_x"),
		).toEqual({ status: "unauthorized" });
		expect(
			await client(() => json(403, "{}")).userInstallations("gho_x"),
		).toEqual({ status: "forbidden" });
	});
});
