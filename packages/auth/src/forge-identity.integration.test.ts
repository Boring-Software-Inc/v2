import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	agentServices,
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { eq } from "drizzle-orm";
import {
	type Fetch,
	githubLogin,
	mirrorForgeIdentity,
	refreshForgeLogin,
} from "./forge-identity.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

function githubReplies(login: string | null, status = 200) {
	const seen: { url: string; authorization: string | null }[] = [];
	const fetcher: Fetch = async (url, init) => {
		seen.push({
			url,
			authorization: new Headers(init?.headers).get("authorization"),
		});
		return new Response(
			JSON.stringify(login ? { login, name: "Jane Doe" } : {}),
			{
				status,
			},
		);
	};
	return { fetcher, seen };
}

async function usernameOf(externalId: string): Promise<string | undefined> {
	const rows = await db
		.select({ username: schema.forgeIdentities.username })
		.from(schema.forgeIdentities)
		.where(eq(schema.forgeIdentities.externalId, externalId));
	return rows[0]?.username;
}

async function seedUser(id: string) {
	await db
		.insert(schema.user)
		.values({ id, name: "Jane Doe", email: `${id}@example.com` });
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("githubLogin", () => {
	test("reads the login from the GitHub user with the account token", async () => {
		const { fetcher, seen } = githubReplies("jdoe");
		expect(await githubLogin("gho_token", fetcher)).toBe("jdoe");
		expect(seen).toEqual([
			{ url: "https://api.github.com/user", authorization: "Bearer gho_token" },
		]);
	});

	test("no token, a failed call or no login gives null", async () => {
		expect(await githubLogin(null, githubReplies("jdoe").fetcher)).toBeNull();
		expect(
			await githubLogin("t", githubReplies("jdoe", 401).fetcher),
		).toBeNull();
		expect(await githubLogin("t", githubReplies(null).fetcher)).toBeNull();
		expect(
			await githubLogin("t", async () => {
				throw new Error("offline");
			}),
		).toBeNull();
	});
});

describe("mirrorForgeIdentity", () => {
	test("stores the GitHub login, not the display name", async () => {
		await seedUser("fi-login");
		await mirrorForgeIdentity(
			db,
			{
				userId: "fi-login",
				providerId: "github",
				accountId: "7001",
				accessToken: "gho_token",
			},
			githubReplies("jdoe").fetcher,
		);
		expect(await usernameOf("7001")).toBe("jdoe");
		expect(await agentServices.getAgentUser(db, "fi-login")).toMatchObject({
			name: "Jane Doe",
			githubLogin: "jdoe",
		});
	});

	test("falls back to the user name when GitHub does not answer", async () => {
		await seedUser("fi-fallback");
		await mirrorForgeIdentity(
			db,
			{
				userId: "fi-fallback",
				providerId: "github",
				accountId: "7002",
				accessToken: "gho_token",
			},
			githubReplies(null, 500).fetcher,
		);
		expect(await usernameOf("7002")).toBe("Jane Doe");
	});

	test("a provider that is not a forge is skipped", async () => {
		await seedUser("fi-credential");
		await mirrorForgeIdentity(
			db,
			{ userId: "fi-credential", providerId: "credential", accountId: "7003" },
			githubReplies("jdoe").fetcher,
		);
		expect(await usernameOf("7003")).toBeUndefined();
	});
});

describe("refreshForgeLogin", () => {
	test("repairs a row that holds the display name on the next sign-in", async () => {
		await seedUser("fi-repair");
		await db.insert(schema.forgeIdentities).values({
			id: "fi-repair-identity",
			userId: "fi-repair",
			forge: "github",
			externalId: "7004",
			username: "Jane Doe",
		});
		await refreshForgeLogin(
			db,
			{ providerId: "github", accountId: "7004", accessToken: "gho_new" },
			githubReplies("jdoe").fetcher,
		);
		expect(await usernameOf("7004")).toBe("jdoe");
	});

	test("keeps the row when GitHub does not answer", async () => {
		await seedUser("fi-keep");
		await db.insert(schema.forgeIdentities).values({
			id: "fi-keep-identity",
			userId: "fi-keep",
			forge: "github",
			externalId: "7005",
			username: "jdoe",
		});
		await refreshForgeLogin(
			db,
			{ providerId: "github", accountId: "7005", accessToken: "gho_new" },
			githubReplies(null, 502).fetcher,
		);
		expect(await usernameOf("7005")).toBe("jdoe");
	});
});
