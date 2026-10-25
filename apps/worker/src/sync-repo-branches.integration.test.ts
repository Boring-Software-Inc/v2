import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	SYNC_REPO_BRANCHES_QUEUE,
	syncRepoBranchesOptions,
	type TestDatabase,
} from "@tripwire/db";
import { GithubHttp } from "@tripwire/forge-github";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { syncRepoBranches } from "./jobs/refresh-suggestions.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let boss: PgBoss;
let repoId: string;
const logger = pino({ level: "silent" });

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	boss = await createBoss(container.url);
	repoId = await repoServices.ensureRepo(db, {
		externalId: "43",
		owner: "acme",
		name: "web",
		fullName: "acme/web",
		installationId: "7",
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

function httpReturning(status: number, body: object[] | string) {
	const urls: string[] = [];
	const http = new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		appId: 1,
		fetchImpl: ((url: string | URL | Request) => {
			urls.push(String(url));
			return Promise.resolve(new Response(JSON.stringify(body), { status }));
		}) as typeof fetch,
	});
	return { http, urls };
}

describe("sync-repo-branches", () => {
	test("caches the repo's branch names from GitHub", async () => {
		const { http, urls } = httpReturning(200, [
			{ name: "main" },
			{ name: "release-please--branches--main" },
		]);
		await syncRepoBranches({ db, http, logger }, { repoId });
		expect(urls.some((url) => url.includes("/repos/acme/web/branches"))).toBe(
			true,
		);
		const list = await repoServices.getRepoSuggestionList(
			db,
			repoId,
			"branches",
		);
		expect(list.values).toEqual(["main", "release-please--branches--main"]);
		expect(list.updatedAt).not.toBeNull();
	});

	test("a failed read keeps the last set", async () => {
		await syncRepoBranches(
			{ db, http: httpReturning(502, "bad gateway").http, logger },
			{ repoId },
		);
		expect(
			await repoServices.getRepoSuggestions(db, repoId, "branches"),
		).toHaveLength(2);
	});

	test("no github reads or no repo is a no-op", async () => {
		await syncRepoBranches({ db, http: null, logger }, { repoId });
		await syncRepoBranches(
			{ db, http: httpReturning(200, []).http, logger },
			{ repoId: "missing" },
		);
		expect(
			await repoServices.getRepoSuggestions(db, repoId, "branches"),
		).toHaveLength(2);
	});

	test("the queue holds one waiting sync per repo", async () => {
		const first = await boss.send(
			SYNC_REPO_BRANCHES_QUEUE,
			{ repoId: "dedupe" },
			syncRepoBranchesOptions("dedupe"),
		);
		const second = await boss.send(
			SYNC_REPO_BRANCHES_QUEUE,
			{ repoId: "dedupe" },
			syncRepoBranchesOptions("dedupe"),
		);
		expect(first).not.toBeNull();
		expect(second).toBeNull();
	});
});
