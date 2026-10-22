import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { JsonValue, WorkflowDefinition } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { repoReviewers, repos } from "../schema/repos.ts";
import {
	lastReviewerSync,
	listRepoReviewers,
	replaceRepoReviewers,
} from "./reviewers.ts";
import {
	createWorkflow,
	setWorkflowEnabled,
	updateWorkflowDefinition,
} from "./workflows.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function newRepo(): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: id,
		owner: "acme",
		name: id,
		fullName: `acme/${id}`,
	});
	return id;
}

const OCTOCAT = {
	id: 583231,
	login: "octocat",
	avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
	permission: "admin",
};
const HUBOT = {
	id: 480938,
	login: "Hubot",
	avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4",
	permission: "write",
};

describe("repo reviewers", () => {
	test("an unsynced repo lists nothing and has no sync time", async () => {
		const repoId = await newRepo();
		expect(await listRepoReviewers(db, repoId)).toEqual({
			reviewers: [],
			syncedAt: null,
		});
		expect(await lastReviewerSync(db, repoId)).toBeNull();
	});

	test("replace stores the set, sorted by login, with the sync time", async () => {
		const repoId = await newRepo();
		const at = new Date("2026-10-21T10:00:00Z");
		await replaceRepoReviewers(db, repoId, [OCTOCAT, HUBOT], at);
		const list = await listRepoReviewers(db, repoId);
		expect(list.reviewers).toEqual([HUBOT, OCTOCAT]);
		expect(list.syncedAt?.toISOString()).toBe(at.toISOString());
		expect((await lastReviewerSync(db, repoId))?.toISOString()).toBe(
			at.toISOString(),
		);
	});

	test("replace drops people no longer in the set and keeps repos apart", async () => {
		const repoId = await newRepo();
		const other = await newRepo();
		await replaceRepoReviewers(db, repoId, [OCTOCAT, HUBOT]);
		await replaceRepoReviewers(db, other, [OCTOCAT]);
		await replaceRepoReviewers(db, repoId, [
			{ ...HUBOT, login: "hubot-renamed" },
		]);
		expect((await listRepoReviewers(db, repoId)).reviewers).toEqual([
			{ ...HUBOT, login: "hubot-renamed" },
		]);
		expect((await listRepoReviewers(db, other)).reviewers).toEqual([OCTOCAT]);
	});

	test("a repeated person is stored once", async () => {
		const repoId = await newRepo();
		await replaceRepoReviewers(db, repoId, [OCTOCAT, OCTOCAT]);
		expect((await listRepoReviewers(db, repoId)).reviewers).toHaveLength(1);
	});

	test("a row that breaks the contract is refused and the old set stays", async () => {
		const repoId = await newRepo();
		await replaceRepoReviewers(db, repoId, [OCTOCAT]);
		await expect(
			replaceRepoReviewers(db, repoId, [{ ...HUBOT, login: "bad name" }]),
		).rejects.toThrow();
		expect((await listRepoReviewers(db, repoId)).reviewers).toEqual([OCTOCAT]);
	});

	test("the database refuses a second row for the same person", async () => {
		const repoId = await newRepo();
		const row = {
			repoId,
			githubUserId: OCTOCAT.id,
			login: OCTOCAT.login,
			avatarUrl: OCTOCAT.avatarUrl,
			permission: OCTOCAT.permission,
		};
		await db.insert(repoReviewers).values({ id: generateId(), ...row });
		await expect(
			db
				.insert(repoReviewers)
				.values({ id: generateId(), ...row })
				.execute(),
		).rejects.toThrow();
	});

	test("deleting the repo deletes its reviewers", async () => {
		const repoId = await newRepo();
		await replaceRepoReviewers(db, repoId, [OCTOCAT]);
		await db.delete(repos).where(eq(repos.id, repoId));
		const left = await db
			.select()
			.from(repoReviewers)
			.where(eq(repoReviewers.repoId, repoId));
		expect(left).toEqual([]);
	});
});

describe("enable with synced reviewers", () => {
	function reviewGraph(reviewers: JsonValue[]): WorkflowDefinition {
		return {
			id: generateId(),
			name: "placeholder",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{
					id: "r",
					type: "rule",
					ref: "account-age@1",
					config: { minDays: 7 },
				},
				{
					id: "a",
					type: "action",
					action: "request-review",
					params: { reviewers },
				},
			],
			edges: [
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "a", when: "fail" },
			],
		};
	}

	async function workflowWith(repoId: string, reviewers: JsonValue[]) {
		const created = await createWorkflow(db, { repoId });
		await updateWorkflowDefinition(db, {
			repoId,
			workflowId: created.id,
			definition: reviewGraph(reviewers),
		});
		return created.id;
	}

	test("a reviewer missing from the synced set enables with a warning", async () => {
		const repoId = await newRepo();
		await replaceRepoReviewers(db, repoId, [OCTOCAT]);
		const workflowId = await workflowWith(repoId, [
			{ id: OCTOCAT.id, login: "octocat" },
			{ id: 9, login: "gone" },
		]);
		const result = await setWorkflowEnabled(db, {
			repoId,
			workflowId,
			enabled: true,
		});
		expect(result.ok).toBe(true);
		expect(result.ok && result.warnings).toMatchObject([
			{
				rule: "stale-reviewer",
				severity: "warning",
				nodeId: "a",
			},
		]);
	});

	test("an unsynced repo enables without reviewer warnings", async () => {
		const repoId = await newRepo();
		const workflowId = await workflowWith(repoId, ["octocat"]);
		expect(
			await setWorkflowEnabled(db, { repoId, workflowId, enabled: true }),
		).toEqual({ ok: true, enabled: true });
	});
});
