import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Verdict } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { repos } from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";
import { loadHomeDigestRepos } from "./home-digest.ts";
import { ensureRepo, upsertRuleConfig } from "./repos.ts";
import { saveRulePreview } from "./rule-previews.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
const FROM = new Date("2026-10-17T12:00:00.000Z");
const TO = new Date("2026-10-24T12:00:00.000Z");
const ORG_ID = generateId();
let repoId: string;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	repoId = await ensureRepo(db, {
		externalId: "521",
		owner: "lumenhq",
		name: "lumen",
		fullName: "lumenhq/lumen",
	});
	await db.update(repos).set({ orgId: ORG_ID });
}, 120_000);

afterAll(async () => {
	await pool?.end();
	await container?.stop();
});

async function addRun(input: {
	repo?: string;
	number?: number;
	verdict: Verdict | null;
	at?: Date;
	kind?: string;
	subjectKind?: string;
}) {
	const eventId = generateId();
	const at = input.at ?? new Date("2026-10-23T12:00:00.000Z");
	await db.insert(events).values({
		id: eventId,
		deliveryId: eventId,
		rawKind: "pull_request",
		raw: {},
		kind: input.kind ?? "change-request.opened",
		repoFullName: input.repo ?? "lumenhq/lumen",
		receivedAt: at,
	});
	await db.insert(runs).values({
		id: generateId(),
		eventId,
		repoFullName: input.repo ?? "lumenhq/lumen",
		subjectNumber: input.number ?? 521,
		subjectKind: input.subjectKind,
		status: input.verdict ? "completed" : "running",
		verdict: input.verdict,
		workflowSnapshot: [],
		createdAt: at,
	});
}

test("reads only this org's live repos and verdict-bearing runs in the week", async () => {
	await addRun({ verdict: "pass", at: FROM });
	await addRun({ verdict: "block", number: 522, at: TO });
	await addRun({ verdict: "close", at: new Date(FROM.getTime() - 1) });
	await addRun({ verdict: "close", at: new Date(TO.getTime() + 1) });
	await addRun({
		verdict: "pass",
		kind: "comment.created",
		subjectKind: "comment",
	});
	await addRun({ verdict: "pass", repo: "another/private" });
	await addRun({ verdict: null, number: 523 });
	const [repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO);
	expect(
		repo?.counts.slice().sort((a, b) => a.verdict.localeCompare(b.verdict)),
	).toEqual([
		{ verdict: "block", count: 1 },
		{ verdict: "pass", count: 1 },
	]);
	expect(
		repo?.latestRuns.find((run) => run.number === 523)?.verdict,
	).toBeNull();
	expect(await loadHomeDigestRepos(db, "another-org", FROM, TO)).toEqual([]);
});

test("latest run replaces an earlier pass, including a run still in progress", async () => {
	await addRun({ verdict: "block", number: 521 });
	let [repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO);
	expect(repo?.latestRuns.find((run) => run.number === 521)?.verdict).toBe(
		"block",
	);
	await addRun({ verdict: null, number: 521 });
	[repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO);
	expect(
		repo?.latestRuns.find((run) => run.number === 521)?.verdict,
	).toBeNull();
});

test("reads saved previews and excludes installed and tuned rules", async () => {
	await addRun({ verdict: "pass", number: 524 });
	await saveRulePreview(
		db,
		repoId,
		{
			windowDays: 30,
			changeRequests: 1,
			recent: [
				{ number: 521, title: "Update funding links", author: "contributor" },
			],
			rules: [{ ruleId: "crypto-address", caught: [521], examples: [] }],
		},
		TO,
	);
	let [repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO);
	expect(repo?.preview?.rules[0]?.caught).toEqual([521]);
	expect(repo?.uninstalledRuleIds).toContain("crypto-address");
	await upsertRuleConfig(db, repoId, {
		ruleId: "crypto-address",
		version: 1,
		enabled: true,
		config: {},
	});
	[repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO);
	expect(repo?.uninstalledRuleIds).not.toContain("crypto-address");
	await upsertRuleConfig(db, repoId, {
		ruleId: "account-age",
		version: 1,
		enabled: false,
		config: { minDays: 99 },
	});
	[repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO);
	expect(repo?.uninstalledRuleIds).not.toContain("account-age");
	[repo] = await loadHomeDigestRepos(db, ORG_ID, FROM, TO, false);
	expect(repo?.preview).toBeNull();
	expect(repo?.uninstalledRuleIds).toEqual([]);
});
