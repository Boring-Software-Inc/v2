import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	repoServices,
	reviewerServices,
	SYNC_REPO_REVIEWERS_QUEUE,
	syncRepoReviewersOptions,
	type TestDatabase,
} from "@tripwire/db";
import { GithubHttp } from "@tripwire/forge-github";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { syncRepoReviewers } from "./jobs/sync-repo-reviewers.ts";

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
		externalId: "42",
		owner: "acme",
		name: "app",
		fullName: "acme/app",
		installationId: "7",
	});
}, 120_000);

afterAll(async () => {
	await boss?.stop({ close: true, graceful: false }).catch(() => undefined);
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

function httpReturning(status: number, body: object[] | string) {
	return new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		fetchImpl: ((_url: string | URL | Request) =>
			Promise.resolve(
				new Response(JSON.stringify(body), { status }),
			)) as typeof fetch,
	});
}

const OCTOCAT = {
	login: "octocat",
	id: 583231,
	avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
	type: "User",
	permissions: {
		admin: true,
		maintain: true,
		push: true,
		triage: true,
		pull: true,
	},
	role_name: "admin",
};

describe("sync-repo-reviewers", () => {
	test("replaces the repo's set with GitHub's push collaborators", async () => {
		await syncRepoReviewers(
			{ db, http: httpReturning(200, [OCTOCAT]), logger },
			{ repoId },
		);
		await syncRepoReviewers(
			{ db, http: httpReturning(200, [OCTOCAT]), logger },
			{ repoId },
		);
		expect(
			(await reviewerServices.listRepoReviewers(db, repoId)).reviewers,
		).toEqual([
			{
				id: 583231,
				login: "octocat",
				avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
				permission: "admin",
			},
		]);
	});

	test("a failed read keeps the last set", async () => {
		await syncRepoReviewers(
			{ db, http: httpReturning(502, "bad gateway"), logger },
			{ repoId },
		);
		expect(
			(await reviewerServices.listRepoReviewers(db, repoId)).reviewers,
		).toHaveLength(1);
	});

	test("no github reads or no repo is a no-op", async () => {
		await syncRepoReviewers({ db, http: null, logger }, { repoId });
		await syncRepoReviewers(
			{ db, http: httpReturning(200, []), logger },
			{ repoId: "missing" },
		);
		expect(
			(await reviewerServices.listRepoReviewers(db, repoId)).reviewers,
		).toHaveLength(1);
	});

	test("the queue holds one waiting sync per repo", async () => {
		const first = await boss.send(
			SYNC_REPO_REVIEWERS_QUEUE,
			{ repoId: "dedupe" },
			syncRepoReviewersOptions("dedupe"),
		);
		const second = await boss.send(
			SYNC_REPO_REVIEWERS_QUEUE,
			{ repoId: "dedupe" },
			syncRepoReviewersOptions("dedupe"),
		);
		const other = await boss.send(
			SYNC_REPO_REVIEWERS_QUEUE,
			{ repoId: "other" },
			syncRepoReviewersOptions("other"),
		);
		expect(first).not.toBeNull();
		expect(second).toBeNull();
		expect(other).not.toBeNull();
	});
});
