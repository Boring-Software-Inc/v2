import { describe, expect, test } from "bun:test";
import { createDb, createPgliteDb } from "@tripwire/db";
import { githubAppIdSchema } from "./forge-runtime.ts";
import { buildGitCafeRuntime } from "./gitcafe-runtime.ts";

describe("GITHUB_APP_ID is the app's own identity", () => {
	test("the production and staging ids parse to numbers", () => {
		expect(githubAppIdSchema.parse("4291944")).toBe(4291944);
		expect(githubAppIdSchema.parse("3169732")).toBe(3169732);
	});

	test("a slug, a blank or a negative id is refused", () => {
		for (const value of ["tripwire-sh", "", "-4", "1.5"]) {
			expect(githubAppIdSchema.safeParse(value).success).toBe(false);
		}
	});
});

test("GitCafe runtime uses the real production pool by default without opening it", async () => {
	const database = createDb("postgres://unused:unused@127.0.0.1:1/unused");
	try {
		const runtime = buildGitCafeRuntime(database.db, {
			appId: "unused",
			keyId: "unused",
			privateKey: "unused",
		});
		expect(runtime.prepareCheckRerequest).toBeFunction();
		expect(database.pool.totalCount).toBe(0);
	} finally {
		await database.pool.end();
	}
});

test("GitCafe runtime checks its default pool only when no pool is injected", async () => {
	const embedded = createPgliteDb();
	const database = createDb("postgres://unused:unused@127.0.0.1:1/unused");
	const credentials = {
		appId: "unused",
		keyId: "unused",
		privateKey: "unused",
	};
	try {
		expect(() => buildGitCafeRuntime(embedded.db, credentials)).toThrow(
			"requires a PostgreSQL connection pool",
		);
		const runtime = buildGitCafeRuntime(
			embedded.db,
			credentials,
			undefined,
			database.pool,
		);
		expect(runtime.prepareCheckRerequest).toBeFunction();
		expect(database.pool.totalCount).toBe(0);
	} finally {
		await database.pool.end();
		await embedded.client.close();
	}
});
