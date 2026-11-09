import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import { eq } from "drizzle-orm";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { repos, ruleConfigs } from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";
import { decideRepoModerationItem } from "./moderation.ts";
import { setRepoArmed, turnOnGate } from "./repos.ts";
import { listRuleViews, saveRuleConfig } from "./rules.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let repoId: string;

async function seedRepo(name: string): Promise<string> {
	const id = generateId();
	await db.insert(repos).values({
		id,
		externalId: generateId(),
		owner: "acme",
		name,
		fullName: `acme/${name}`,
	});
	return id;
}

async function seedPendingItem(repoFullName: string): Promise<string> {
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: `d-${eventId}`,
		rawKind: "pull_request",
		raw: {},
		kind: "change-request.opened",
		repoFullName,
		subjectNumber: 1,
	});
	const runId = generateId();
	await db.insert(runs).values({
		id: runId,
		eventId,
		repoFullName,
		subjectNumber: 1,
		headSha: "sha",
		status: "paused",
		workflowSnapshot: [],
	});
	const itemId = generateId();
	await db.insert(moderationItems).values({ id: itemId, runId, nodeId: "n1" });
	return itemId;
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
	repoId = await seedRepo("web");
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("turnOnGate", () => {
	test("arms the repo with no queue", async () => {
		expect(await turnOnGate(db, null, repoId)).toEqual({
			ok: true,
			armed: true,
		});
		const rows = await db
			.select({ armed: repos.armed })
			.from(repos)
			.where(eq(repos.id, repoId));
		expect(rows[0]?.armed).toBe(true);
	});
});

test("OpenGit still arms, disarms and resolves the backfill queue once", async () => {
	const id = generateId();
	await db.insert(repos).values({
		id,
		forge: "opengit",
		externalId: id,
		owner: "acme",
		name: "legacy",
		fullName: "acme/legacy",
	});
	expect(await setRepoArmed(db, id, true)).toEqual({ ok: true, armed: true });
	expect(await setRepoArmed(db, id, false)).toEqual({ ok: true, armed: false });
	let queueReads = 0;
	const queue = async () => {
		queueReads++;
		return null;
	};
	expect(await turnOnGate(db, queue, id)).toEqual({ ok: true, armed: true });
	expect(await turnOnGate(db, queue, id)).toEqual({ ok: true, armed: true });
	expect(queueReads).toBe(1);
});

describe("saveRuleConfig", () => {
	test("refuses an unknown rule", async () => {
		const result = await saveRuleConfig(db, {
			repoId,
			ruleId: "no-such-rule",
			enabled: true,
			config: {},
		});
		expect("error" in result).toBe(true);
	});

	test("refuses config that fails the rule schema", async () => {
		const result = await saveRuleConfig(db, {
			repoId,
			ruleId: "account-age",
			enabled: true,
			config: { minDays: "soon" },
		});
		expect("error" in result).toBe(true);
	});

	test("saves a valid config and the view reflects it", async () => {
		const result = await saveRuleConfig(db, {
			repoId,
			ruleId: "account-age",
			enabled: false,
			config: { minDays: 14 },
		});
		expect(result).toEqual({ ok: true });
		const stored = await db
			.select()
			.from(ruleConfigs)
			.where(eq(ruleConfigs.repoId, repoId));
		expect(stored.map((row) => row.ruleId)).toContain("account-age");
		const views = await listRuleViews(db, repoId);
		expect(views.find((v) => v.ruleId === "account-age")?.enabled).toBe(false);
	});
});

describe("decideRepoModerationItem", () => {
	test("a foreign repo's item reads as missing", async () => {
		const itemId = await seedPendingItem("other/repo");
		const result = await decideRepoModerationItem(db, null, {
			repo: { forge: "github", fullName: "acme/web" },
			itemId,
			decision: "approve",
			decidedBy: null,
		});
		expect(result).toBe("not-found");
	});

	test("decides an item on its own repo once", async () => {
		const itemId = await seedPendingItem("acme/web");
		const input = {
			repo: { forge: "github" as const, fullName: "acme/web" },
			itemId,
			decision: "deny" as const,
			decidedBy: null,
		};
		expect(await decideRepoModerationItem(db, null, input)).toEqual({
			ok: true,
		});
		expect(await decideRepoModerationItem(db, null, input)).toEqual({
			ok: false,
			reason: "already-decided",
		});
	});

	test("an item closed with its change request says so", async () => {
		const itemId = await seedPendingItem("acme/web");
		await db
			.update(moderationItems)
			.set({ status: "closed", decidedAt: new Date() })
			.where(eq(moderationItems.id, itemId));
		expect(
			await decideRepoModerationItem(db, null, {
				repo: { forge: "github", fullName: "acme/web" },
				itemId,
				decision: "approve",
				decidedBy: null,
			}),
		).toEqual({ ok: false, reason: "closed" });
	});
});
