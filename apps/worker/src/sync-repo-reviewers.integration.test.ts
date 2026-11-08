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

function httpReturning(
	status: number,
	body: object[] | string,
	paginated = false,
) {
	return new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		appId: 1,
		fetchImpl: ((_url: string | URL | Request) =>
			Promise.resolve(
				new Response(JSON.stringify(body), {
					status,
					headers: paginated
						? {
								link: '<https://api.github.com/repos/acme/app/collaborators?page=11>; rel="next"',
							}
						: {},
				}),
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

	test("a truncated collaborator list keeps the last set", async () => {
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

		const fullPage = Array.from({ length: 100 }, (_, i) => ({
			...OCTOCAT,
			id: 583231 + i,
			login: `user${i}`,
		}));
		await syncRepoReviewers(
			{ db, http: httpReturning(200, fullPage, true), logger },
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

	test("no github reads or no repo leaves the rows untouched", async () => {
		await syncRepoReviewers({ db, http: null, logger }, { repoId });
		await syncRepoReviewers(
			{ db, http: httpReturning(200, []), logger },
			{ repoId: "missing" },
		);
		expect(
			(await reviewerServices.listRepoReviewers(db, repoId)).reviewers,
		).toHaveLength(1);
	});

	test("a sync with github reads disabled stamps the sync time", async () => {
		const disabledRepo = await repoServices.ensureRepo(db, {
			externalId: "disabled",
			owner: "acme",
			name: "disabled",
			fullName: "acme/disabled",
			installationId: "7",
		});
		await syncRepoReviewers(
			{ db, http: null, logger },
			{ repoId: disabledRepo },
		);
		const list = await reviewerServices.listRepoReviewers(db, disabledRepo);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt).not.toBeNull();
		expect(reviewerServices.reviewersNeedSync(list.syncedAt, new Date())).toBe(
			false,
		);
	});

	test("a sync for a non-github repo stamps the sync time", async () => {
		const opengitRepo = await repoServices.ensureRepo(db, {
			forge: "opengit",
			externalId: "og-1",
			owner: "acme",
			name: "opengit-repo",
			fullName: "acme/opengit-repo",
			installationId: "7",
		});
		await syncRepoReviewers(
			{ db, http: httpReturning(200, [OCTOCAT]), logger },
			{ repoId: opengitRepo },
		);
		const list = await reviewerServices.listRepoReviewers(db, opengitRepo);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt).not.toBeNull();
	});

	test("an empty collaborator list stamps the sync time", async () => {
		const emptyRepo = await repoServices.ensureRepo(db, {
			externalId: "empty",
			owner: "acme",
			name: "empty",
			fullName: "acme/empty",
			installationId: "7",
		});
		await syncRepoReviewers(
			{ db, http: httpReturning(200, []), logger },
			{ repoId: emptyRepo },
		);
		const list = await reviewerServices.listRepoReviewers(db, emptyRepo);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt).not.toBeNull();
		expect(reviewerServices.reviewersNeedSync(list.syncedAt, new Date())).toBe(
			false,
		);
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
