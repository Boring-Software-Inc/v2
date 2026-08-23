import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { JsonValue } from "@tripwire/contracts";
import { isRepoPublic, listInstallationRepos } from "./installation.ts";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});
const CREDS = { botId: "bot-1", privateKey };

function reply(body: JsonValue, status = 200) {
	const calls: { url: string; authorization: string }[] = [];
	const fetchImpl = ((url: string, init?: RequestInit) => {
		calls.push({
			url: String(url),
			authorization: String(
				(init?.headers as Record<string, string>)?.authorization ?? "",
			),
		});
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
		);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

describe("installation repos", () => {
	/**
	 * The whole reason this call exists: open-git's installation webhook names
	 * repositories by bare uuid, so the delivery alone cannot build a repo row.
	 */
	test("turns the api's repositories into full names", async () => {
		const { calls, fetchImpl } = reply({
			id: "inst-1",
			status: "active",
			repositories: [
				{ id: "r1", name: "playground", owner: "boring" },
				{ id: "r2", name: "v2", owner: "boring" },
			],
		});
		const result = await listInstallationRepos(
			CREDS,
			"inst-1",
			undefined,
			fetchImpl,
		);
		expect(result.active).toBe(true);
		expect(result.repos).toEqual([
			{
				externalId: "r1",
				owner: "boring",
				name: "playground",
				fullName: "boring/playground",
			},
			{ externalId: "r2", owner: "boring", name: "v2", fullName: "boring/v2" },
		]);
		expect(calls[0]?.url).toContain("/api/v1/app/installations/inst-1");
		// The BOT jwt, not an installation token — there is no repo to mint one
		// against yet, which is exactly what this call is discovering.
		expect(calls[0]?.authorization.startsWith("Bearer ey")).toBe(true);
	});

	test("a suspended installation reports inactive", async () => {
		const { fetchImpl } = reply({
			id: "inst-1",
			status: "suspended",
			repositories: [],
		});
		const result = await listInstallationRepos(
			CREDS,
			"inst-1",
			undefined,
			fetchImpl,
		);
		expect(result.active).toBe(false);
	});

	test("an absent repositories array is empty, never undefined", async () => {
		const { fetchImpl } = reply({ id: "inst-1", status: "active" });
		const result = await listInstallationRepos(
			CREDS,
			"inst-1",
			undefined,
			fetchImpl,
		);
		expect(result.repos).toEqual([]);
	});

	test("a non-2xx throws so the worker does not record an empty grant", async () => {
		const { fetchImpl } = reply({ error: "gone" }, 404);
		await expect(
			listInstallationRepos(CREDS, "inst-1", undefined, fetchImpl),
		).rejects.toThrow(/installation lookup failed/);
	});
});

describe("repo visibility probe", () => {
	const status = (code: number) => {
		const calls: { url: string; redirect: string; auth: string | null }[] = [];
		const fetchImpl = ((url: string, init?: RequestInit) => {
			calls.push({
				url: String(url),
				redirect: String(init?.redirect ?? ""),
				auth: new Headers(init?.headers).get("authorization"),
			});
			return Promise.resolve(new Response("", { status: code }));
		}) as unknown as typeof fetch;
		return { calls, fetchImpl };
	};

	test("200 means public", async () => {
		const { fetchImpl } = status(200);
		expect(await isRepoPublic("boring/v2", undefined, fetchImpl)).toBe(true);
	});

	/**
	 * The asymmetry that makes this safe: a private repo answers 404 to an
	 * anonymous request, so it can never be read as public.
	 */
	test("404 is not public, whether private or gone", async () => {
		const { fetchImpl } = status(404);
		expect(await isRepoPublic("boring/playground", undefined, fetchImpl)).toBe(
			false,
		);
	});

	test("a redirect is not public, even though it is not an error", async () => {
		// A redirect to a sign-in page is the opposite of what a 2xx implies.
		const { fetchImpl } = status(302);
		expect(await isRepoPublic("boring/x", undefined, fetchImpl)).toBe(false);
	});

	test("it never follows a redirect, and never sends credentials", async () => {
		const { calls, fetchImpl } = status(200);
		await isRepoPublic("boring/v2", undefined, fetchImpl);
		// An installation token would make a PRIVATE repo answer 200 and invert
		// the whole inference.
		expect(calls[0]?.auth).toBeNull();
		expect(calls[0]?.redirect).toBe("manual");
	});

	test("a network failure is not evidence — it fails closed", async () => {
		const fetchImpl = (() =>
			Promise.reject(new Error("offline"))) as unknown as typeof fetch;
		expect(await isRepoPublic("boring/v2", undefined, fetchImpl)).toBe(false);
	});

	test("a self-hosted origin is honoured", async () => {
		const { calls, fetchImpl } = status(200);
		await isRepoPublic("boring/v2", "https://git.internal/", fetchImpl);
		expect(calls[0]?.url).toBe("https://git.internal/boring/v2");
	});
});
