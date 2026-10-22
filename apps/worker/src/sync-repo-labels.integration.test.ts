import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createBoss,
	createDb,
	createTestDatabase,
	type Db,
	labelServices,
	repoServices,
	SYNC_REPO_LABELS_QUEUE,
	syncRepoLabelsOptions,
	type TestDatabase,
} from "@tripwire/db";
import { GithubHttp } from "@tripwire/forge-github";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import issueComment from "../../../packages/forge-github/fixtures/issue_comment.created.json";
import { syncRepoLabels } from "./jobs/sync-repo-labels.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let boss: PgBoss;
let repoId: string;
const logger = pino({ level: "silent" });
const BUG = issueComment.issue.labels[0] as {
	id: number;
	node_id: string;
	url: string;
	name: string;
	color: string;
	default: boolean;
};

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

describe("sync-repo-labels", () => {
	test("replaces the repo's labels with GitHub's", async () => {
		const stale = { ...BUG, name: "stale", color: "CFD3D7", default: false };
		await syncRepoLabels(
			{ db, http: httpReturning(200, [BUG, stale]), logger },
			{ repoId },
		);
		await syncRepoLabels(
			{ db, http: httpReturning(200, [stale, BUG]), logger },
			{ repoId },
		);
		const list = await labelServices.listRepoLabels(db, repoId);
		expect(list.labels).toEqual([
			{ name: "bug", color: "d73a4a", description: null },
			{ name: "stale", color: "cfd3d7", description: null },
		]);
		expect(list.syncedAt).not.toBeNull();
	});

	test("a failed read keeps the last set", async () => {
		await syncRepoLabels(
			{ db, http: httpReturning(502, "bad gateway"), logger },
			{ repoId },
		);
		expect(
			(await labelServices.listRepoLabels(db, repoId)).labels,
		).toHaveLength(2);
	});

	test("no github reads or no repo is a no-op", async () => {
		await syncRepoLabels({ db, http: null, logger }, { repoId });
		await syncRepoLabels(
			{ db, http: httpReturning(200, []), logger },
			{ repoId: "missing" },
		);
		expect(
			(await labelServices.listRepoLabels(db, repoId)).labels,
		).toHaveLength(2);
	});

	test("the queue holds one waiting sync per repo", async () => {
		const first = await boss.send(
			SYNC_REPO_LABELS_QUEUE,
			{ repoId: "dedupe" },
			syncRepoLabelsOptions("dedupe"),
		);
		const second = await boss.send(
			SYNC_REPO_LABELS_QUEUE,
			{ repoId: "dedupe" },
			syncRepoLabelsOptions("dedupe"),
		);
		expect(first).not.toBeNull();
		expect(second).toBeNull();
	});
});
