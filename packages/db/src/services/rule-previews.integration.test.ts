import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import { runSteps, runs } from "../schema/runs.ts";
import * as repoServices from "./repos.ts";
import * as previewServices from "./rule-previews.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const NOW = new Date();
const DAY = 86_400_000;

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function opened(
	number: number,
	daysAgo: number,
	association: string,
): Promise<void> {
	const receivedAt = new Date(NOW.getTime() - daysAgo * DAY);
	await db.insert(events).values({
		id: generateId(),
		deliveryId: `d-${number}-${daysAgo}`,
		rawKind: "pull_request",
		raw: { pull_request: { author_association: association } },
		receivedAt,
		kind: "change-request.opened",
		repoFullName: "acme/app",
		actorLogin: `user-${number}`,
		subjectNumber: number,
		normalized: {
			id: generateId(),
			forge: "github",
			deliveryId: `d-${number}`,
			repo: { owner: "acme", name: "app", fullName: "acme/app" },
			actor: { login: `user-${number}`, externalId: String(number) },
			occurredAt: receivedAt.toISOString(),
			receivedAt: receivedAt.toISOString(),
			kind: "change-request.opened",
			changeRequest: {
				number,
				title: `Change ${number}`,
				headSha: "abc",
				url: `https://github.com/acme/app/pull/${number}`,
			},
		},
	});
}

test("loads the window's change requests and their stored rule steps", async () => {
	await opened(3, 2, "NONE");
	await opened(2, 5, "OWNER");
	await opened(1, 45, "NONE");
	const [event] = await db.select({ id: events.id }).from(events).limit(1);
	if (!event) throw new Error("missing event");
	const runId = generateId();
	await db.insert(runs).values({
		id: runId,
		eventId: event.id,
		repoFullName: "acme/app",
		subjectNumber: 3,
		status: "completed",
		verdict: "block",
		workflowSnapshot: [],
	});
	await db.insert(runSteps).values({
		id: generateId(),
		runId,
		nodeId: "default@1:rule-0",
		nodeKind: "rule",
		ruleId: "account-age@1",
		status: "fail",
		input: { ref: "account-age@1", config: { minDays: 7 } },
		evidence: {
			ruleId: "account-age",
			version: 1,
			status: "evaluated",
			passed: false,
			evaluatedAt: NOW.toISOString(),
			evidence: { accountAgeDays: 1, minDays: 7 },
		},
		summary: "Your account is 1 day old.",
		startedAt: NOW,
		finishedAt: NOW,
		durationMs: 1,
	});

	const inputs = await previewServices.loadPreviewInputs(
		db,
		{ fullName: "acme/app", forge: "github" },
		new Date(NOW.getTime() - 30 * DAY),
	);
	expect(inputs.changeRequests.map((cr) => cr.number)).toEqual([3, 2]);
	expect(inputs.changeRequests[1]?.authorAssociation).toBe("OWNER");
	expect(inputs.changeRequests[0]?.title).toBe("Change 3");
	expect(inputs.changeRequests[0]?.eventId).toBe(event.id);
	expect(inputs.steps).toEqual([
		{
			number: 3,
			eventId: event.id,
			ref: "account-age@1",
			config: { minDays: 7 },
			status: "fail",
			evidence: { accountAgeDays: 1, minDays: 7 },
		},
	]);
});

test("a saved preview reads back and goes stale after an hour", async () => {
	const repoId = await repoServices.ensureRepo(db, {
		externalId: "9",
		owner: "acme",
		name: "app",
		fullName: "acme/app",
	});
	expect(await previewServices.getRulePreview(db, repoId)).toBeNull();
	const preview = {
		windowDays: 30,
		changeRequests: 1,
		rules: [],
		recent: [
			{ number: 4, title: "Add airdrop section", author: "wallet-hub-01" },
		],
	};
	await previewServices.saveRulePreview(db, repoId, preview, NOW);
	const stored = await previewServices.getRulePreview(db, repoId);
	expect(stored?.preview).toEqual(preview);
	expect(previewServices.previewNeedsRefresh(stored, NOW)).toBe(false);
	expect(
		previewServices.previewNeedsRefresh(
			stored,
			new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
		),
	).toBe(true);
});

test("usage counts armed repos with a rule on", async () => {
	const armed = await repoServices.ensureRepo(db, {
		externalId: "10",
		owner: "acme",
		name: "armed",
		fullName: "acme/armed",
	});
	const idle = await repoServices.ensureRepo(db, {
		externalId: "11",
		owner: "acme",
		name: "idle",
		fullName: "acme/idle",
	});
	await repoServices.setRepoArmed(db, armed, true);
	for (const repoId of [armed, idle]) {
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "honeypot",
			version: 1,
			enabled: true,
			config: { paths: ["x/**"] },
		});
	}
	await repoServices.upsertRuleConfig(db, armed, {
		ruleId: "account-age",
		version: 1,
		enabled: false,
		config: { minDays: 7 },
	});
	expect(await previewServices.getRuleUsage(db)).toEqual({
		repos: 1,
		byRule: { honeypot: 1 },
	});
});
