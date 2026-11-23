import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { user } from "../schema/auth.ts";
import { events } from "../schema/events.ts";
import { organization } from "../schema/organizations.ts";
import { runSteps, runs } from "../schema/runs.ts";
import {
	failedRulesForChangeRequests,
	finishOnboarding,
	getOnboarding,
	isOrgSlugTaken,
	listStoredChangeRequests,
	onboardingRequired,
	saveOnboardingProgress,
} from "./user-onboarding.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const REPO = { fullName: "lumenhq/web", forge: "github" };

async function newUser(name: string): Promise<string> {
	const id = generateId();
	await db.insert(user).values({ id, name, email: `${name}@example.com` });
	return id;
}

async function storeRun(input: {
	number: number;
	at: string;
	steps: { ruleId: string; status: string }[];
}) {
	const at = new Date(input.at);
	const eventId = generateId();
	await db.insert(events).values({
		id: eventId,
		deliveryId: generateId(),
		rawKind: "pull_request",
		raw: {},
		receivedAt: at,
		kind: "change-request.updated",
		repoFullName: REPO.fullName,
		subjectNumber: input.number,
		normalized: {},
		normalizedAt: at,
	});
	const runId = generateId();
	await db.insert(runs).values({
		id: runId,
		eventId,
		repoFullName: REPO.fullName,
		subjectNumber: input.number,
		status: "completed",
		workflowSnapshot: [],
		createdAt: at,
	});
	for (const step of input.steps) {
		await db.insert(runSteps).values({
			id: generateId(),
			runId,
			nodeId: step.ruleId,
			nodeKind: "rule",
			ruleId: step.ruleId,
			status: step.status,
			startedAt: at,
			finishedAt: at,
			durationMs: 1,
		});
	}
}

async function storeEvent(input: {
	number: number;
	kind: string;
	title?: string;
	author?: string;
	at: string;
}) {
	const receivedAt = new Date(input.at);
	await db.insert(events).values({
		id: generateId(),
		deliveryId: generateId(),
		rawKind: "pull_request",
		raw: {},
		receivedAt,
		kind: input.kind,
		repoFullName: REPO.fullName,
		subjectNumber: input.number,
		normalized: {
			changeRequest: { title: input.title ?? "untitled" },
			actor: { login: input.author ?? "someone" },
		},
		normalizedAt: receivedAt,
	});
}

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool.end();
	await container.stop();
});

describe("user onboarding", () => {
	test("a user with no row still has onboarding to do", async () => {
		const userId = await newUser("fresh");
		expect(await getOnboarding(db, userId)).toBeNull();
		expect(await onboardingRequired(db, userId)).toBe(true);
	});

	test("progress merges answers and keeps the step and choices", async () => {
		const userId = await newUser("ada");
		const first = await saveOnboardingProgress(db, {
			userId,
			step: "problems",
			answers: { intents: ["crypto-spam", "new-accounts"] },
		});
		expect(first?.step).toBe("problems");
		expect(first?.answers.intents).toEqual(["crypto-spam", "new-accounts"]);

		const second = await saveOnboardingProgress(db, {
			userId,
			step: "about",
			answers: { usage: "team", role: "maintainer" },
		});
		expect(second?.answers).toMatchObject({
			intents: ["crypto-spam", "new-accounts"],
			usage: "team",
			role: "maintainer",
			teamSize: null,
		});
		expect(second?.status).toBe("in_progress");
		expect(await onboardingRequired(db, userId)).toBe(true);
	});

	test("rejects answers that break the contract", async () => {
		const userId = await newUser("bob");
		await expect(
			saveOnboardingProgress(db, {
				userId,
				answers: { reported: [1, 2, 3, 4, 5, 6] },
			}),
		).rejects.toThrow();
	});

	test("progress only moves forward, while answers still change", async () => {
		const userId = await newUser("bo");
		await saveOnboardingProgress(db, { userId, step: "rules" });
		const revisited = await saveOnboardingProgress(db, {
			userId,
			step: "workspace",
			answers: { role: "security" },
		});
		expect(revisited?.step).toBe("rules");
		expect(revisited?.answers.role).toBe("security");
		const ahead = await saveOnboardingProgress(db, { userId, step: "check" });
		expect(ahead?.step).toBe("check");
	});

	test("skipping clears the requirement and freezes progress", async () => {
		const userId = await newUser("cy");
		await saveOnboardingProgress(db, { userId, step: "rules" });
		await finishOnboarding(db, { userId, outcome: "skipped" });
		expect(await onboardingRequired(db, userId)).toBe(false);
		expect(
			await saveOnboardingProgress(db, { userId, step: "agents" }),
		).toBeNull();
		expect((await getOnboarding(db, userId))?.step).toBe("rules");
	});

	test("completing without a row still clears it, and stays completed", async () => {
		const userId = await newUser("di");
		await finishOnboarding(db, { userId, outcome: "completed" });
		await finishOnboarding(db, { userId, outcome: "skipped" });
		expect((await getOnboarding(db, userId))?.status).toBe("completed");
		expect(await onboardingRequired(db, userId)).toBe(false);
	});
});

describe("stored change requests", () => {
	test("lists newest activity first with open and closed state", async () => {
		await storeEvent({
			number: 398,
			kind: "change-request.opened",
			title: "Fix typo in CONTRIBUTING",
			author: "mira-k",
			at: "2026-11-10T10:00:00Z",
		});
		await storeEvent({
			number: 398,
			kind: "change-request.closed",
			at: "2026-11-12T10:00:00Z",
		});
		await storeEvent({
			number: 409,
			kind: "change-request.opened",
			title: "Claim your contributor airdrop",
			author: "ghostdev1",
			at: "2026-11-20T10:00:00Z",
		});
		await storeEvent({
			number: 412,
			kind: "change-request.opened",
			title: "Update README badges",
			author: "ghostdev1",
			at: "2026-11-22T10:00:00Z",
		});

		const all = await listStoredChangeRequests(db, REPO);
		expect(all.map((cr) => cr.number)).toEqual([412, 409, 398]);
		expect(all[2]).toMatchObject({
			title: "Fix typo in CONTRIBUTING",
			author: "mira-k",
			closedAt: "2026-11-12T10:00:00.000Z",
		});
		expect(all[0]?.closedAt).toBeNull();
	});

	test("searches by title or number", async () => {
		const byTitle = await listStoredChangeRequests(db, REPO, {
			query: "airdrop",
		});
		expect(byTitle.map((cr) => cr.number)).toEqual([409]);
		const byNumber = await listStoredChangeRequests(db, REPO, {
			query: "#412",
		});
		expect(byNumber.map((cr) => cr.number)).toEqual([412]);
		const wildcard = await listStoredChangeRequests(db, REPO, {
			query: "%",
		});
		expect(wildcard).toEqual([]);
	});
});

describe("drafting inputs", () => {
	test("reports which slugs are taken", async () => {
		await db.insert(organization).values({
			id: generateId(),
			name: "acme",
			slug: "acme",
			isPersonal: false,
		});
		expect(await isOrgSlugTaken(db, "acme")).toBe(true);
		expect(await isOrgSlugTaken(db, "acme-labs")).toBe(false);
	});

	test("failed rules come from the latest run of each reported request", async () => {
		await storeRun({
			number: 501,
			at: "2026-11-20T10:00:00Z",
			steps: [{ ruleId: "english-only@1", status: "fail" }],
		});
		await storeRun({
			number: 501,
			at: "2026-11-21T10:00:00Z",
			steps: [
				{ ruleId: "account-age@1", status: "fail" },
				{ ruleId: "english-only@1", status: "pass" },
			],
		});
		await storeRun({
			number: 502,
			at: "2026-11-21T11:00:00Z",
			steps: [
				{ ruleId: "account-age@1", status: "fail" },
				{ ruleId: "crypto-address@3", status: "fail" },
			],
		});
		expect(await failedRulesForChangeRequests(db, REPO, [501, 502])).toEqual([
			"account-age",
			"crypto-address",
		]);
		expect(await failedRulesForChangeRequests(db, REPO, [])).toEqual([]);
	});
});
