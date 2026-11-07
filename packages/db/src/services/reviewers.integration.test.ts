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
	replaceGitCafeReviewerSuggestions,
	replaceRepoReviewers,
	reviewersNeedSync,
	stampRepoReviewerSync,
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
	test("GitCafe cache preserves stable string IDs, empty syncs and other repositories", async () => {
		const repoId = await newRepo();
		await db
			.update(repos)
			.set({ forge: "gitcafe" })
			.where(eq(repos.id, repoId));
		const other = await newRepo();
		await replaceRepoReviewers(db, other, [OCTOCAT]);
		const person = {
			id: "act_synthetic-stable",
			login: "provider_handle",
			avatarUrl: "",
			permission: "review-candidate",
		};
		await replaceGitCafeReviewerSuggestions(db, repoId, [person, person]);
		expect((await listRepoReviewers(db, repoId)).reviewers).toEqual([person]);
		await replaceGitCafeReviewerSuggestions(db, repoId, [
			{ ...person, login: "renamed_handle" },
		]);
		expect((await listRepoReviewers(db, repoId)).reviewers).toEqual([
			{ ...person, login: "renamed_handle" },
		]);
		await expect(
			replaceGitCafeReviewerSuggestions(db, repoId, [OCTOCAT]),
		).rejects.toThrow();
		expect((await listRepoReviewers(db, repoId)).reviewers).toHaveLength(1);
		await replaceGitCafeReviewerSuggestions(db, repoId, []);
		const empty = await listRepoReviewers(db, repoId);
		expect(empty.reviewers).toEqual([]);
		expect(empty.syncedAt).not.toBeNull();
		expect((await listRepoReviewers(db, other)).reviewers).toEqual([OCTOCAT]);
	});
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

describe("empty reviewer sync", () => {
	test("an empty sync records the sync time and the throttle engages", async () => {
		const repoId = await newRepo();
		const at = new Date("2026-10-23T10:00:00Z");
		await replaceRepoReviewers(db, repoId, [], at);
		const list = await listRepoReviewers(db, repoId);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt).not.toBeNull();
		expect(list.syncedAt?.toISOString()).toBe(at.toISOString());
		expect(
			reviewersNeedSync(list.syncedAt, new Date("2026-10-23T10:30:00Z")),
		).toBe(false);
		expect(
			reviewersNeedSync(list.syncedAt, new Date("2026-10-24T11:00:00Z")),
		).toBe(true);
		expect((await lastReviewerSync(db, repoId))?.toISOString()).toBe(
			at.toISOString(),
		);
	});

	test("two empty syncs a day apart both record their time", async () => {
		const repoId = await newRepo();
		const first = new Date("2026-10-23T10:00:00Z");
		const second = new Date("2026-10-24T10:00:00Z");
		await replaceRepoReviewers(db, repoId, [], first);
		await replaceRepoReviewers(db, repoId, [], second);
		const list = await listRepoReviewers(db, repoId);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt?.toISOString()).toBe(second.toISOString());
		expect(reviewersNeedSync(list.syncedAt, second)).toBe(false);
	});

	test("a non-empty sync after an empty one keeps the later stamp", async () => {
		const repoId = await newRepo();
		const emptyAt = new Date("2026-10-23T10:00:00Z");
		const fullAt = new Date("2026-10-23T11:00:00Z");
		await replaceRepoReviewers(db, repoId, [], emptyAt);
		await replaceRepoReviewers(db, repoId, [OCTOCAT], fullAt);
		const list = await listRepoReviewers(db, repoId);
		expect(list.reviewers).toEqual([OCTOCAT]);
		expect(list.syncedAt?.toISOString()).toBe(fullAt.toISOString());
	});

	test("an empty sync after a non-empty one updates the stamp", async () => {
		const repoId = await newRepo();
		const fullAt = new Date("2026-10-23T10:00:00Z");
		const emptyAt = new Date("2026-10-23T11:00:00Z");
		await replaceRepoReviewers(db, repoId, [OCTOCAT], fullAt);
		await replaceRepoReviewers(db, repoId, [], emptyAt);
		const list = await listRepoReviewers(db, repoId);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt?.toISOString()).toBe(emptyAt.toISOString());
	});

	test("stampRepoReviewerSync records the time without touching rows", async () => {
		const repoId = await newRepo();
		const rowAt = new Date("2026-10-23T10:00:00Z");
		await replaceRepoReviewers(db, repoId, [OCTOCAT], rowAt);
		const before = await listRepoReviewers(db, repoId);
		expect(before.reviewers).toEqual([OCTOCAT]);
		const stampAt = new Date("2026-10-24T10:00:00Z");
		await stampRepoReviewerSync(db, repoId, stampAt);
		const after = await listRepoReviewers(db, repoId);
		expect(after.reviewers).toEqual([OCTOCAT]);
		expect(after.syncedAt?.toISOString()).toBe(stampAt.toISOString());
	});

	test("stampRepoReviewerSync on an unsynced repo makes it fresh", async () => {
		const repoId = await newRepo();
		const at = new Date("2026-10-24T10:00:00Z");
		await stampRepoReviewerSync(db, repoId, at);
		const list = await listRepoReviewers(db, repoId);
		expect(list.reviewers).toEqual([]);
		expect(list.syncedAt?.toISOString()).toBe(at.toISOString());
		expect(
			reviewersNeedSync(list.syncedAt, new Date("2026-10-24T10:30:00Z")),
		).toBe(false);
	});

	test("deleting the repo deletes its sync stamp", async () => {
		const repoId = await newRepo();
		await stampRepoReviewerSync(db, repoId);
		expect(await lastReviewerSync(db, repoId)).not.toBeNull();
		await db.delete(repos).where(eq(repos.id, repoId));
		expect(await lastReviewerSync(db, repoId)).toBeNull();
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
