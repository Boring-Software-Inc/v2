import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId } from "@tripwire/utils";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import {
	organization,
	organizationInstallations,
	organizationResponseDefaults,
} from "../schema/organizations.ts";
import { runs } from "../schema/runs.ts";
import {
	claimOnboardingEvent,
	getRepoSetupFacts,
	latestOpenChangeRequest,
	markResponsesReviewed,
} from "./repo-setup.ts";
import * as repoServices from "./repos.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

const orgId = generateId();
const otherOrgId = generateId();

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	await db.insert(organization).values([
		{ id: orgId, name: "lumenhq", slug: "lumenhq", isPersonal: false },
		{ id: otherOrgId, name: "other", slug: "other", isPersonal: false },
	]);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

async function addEvent(
	fullName: string,
	number: number,
	kind: string,
	receivedAt: Date,
): Promise<string> {
	const id = generateId();
	await db.insert(events).values({
		id,
		deliveryId: generateId(),
		rawKind: "pull_request",
		raw: {},
		receivedAt,
		kind,
		repoFullName: fullName,
		subjectNumber: number,
		normalized: {},
		normalizedAt: receivedAt,
	});
	return id;
}

describe("repo setup facts", () => {
	test("a fresh repo has nothing done", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "10",
			owner: "lumenhq",
			name: "fresh",
			fullName: "lumenhq/fresh",
			installationId: "inst-1",
			orgId,
		});
		expect(await getRepoSetupFacts(db, { orgId, repoId })).toEqual({
			installed: false,
			armed: false,
			enabledRuleIds: [],
			customRulesOn: 0,
			workflowsOn: 0,
			firstCheck: null,
			nextChangeRequest: null,
			responsesChosen: false,
			onboardingStarted: false,
			onboardingCompleted: false,
		});
		expect(
			await getRepoSetupFacts(db, { orgId: otherOrgId, repoId }),
		).toBeNull();
	});

	test("each step reads from what the repo has", async () => {
		await db.insert(organizationInstallations).values({
			id: generateId(),
			organizationId: orgId,
			installationId: "inst-2",
		});
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "11",
			owner: "lumenhq",
			name: "lumen",
			fullName: "lumenhq/lumen",
			installationId: "inst-2",
			orgId,
		});
		await repoServices.setRepoArmed(db, repoId, true);
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "account-age",
			version: 1,
			enabled: true,
			config: { minDays: 7 },
		});
		await repoServices.upsertRuleConfig(db, repoId, {
			ruleId: "honeypot",
			version: 1,
			enabled: false,
			config: { paths: [".github/workflows/**"] },
		});
		const t0 = new Date("2026-10-20T10:00:00.000Z");
		const opened = await addEvent(
			"lumenhq/lumen",
			509,
			"change-request.opened",
			t0,
		);
		await addEvent(
			"lumenhq/lumen",
			512,
			"change-request.opened",
			new Date(t0.getTime() + 60_000),
		);
		await addEvent(
			"lumenhq/lumen",
			512,
			"change-request.closed",
			new Date(t0.getTime() + 120_000),
		);
		await addEvent(
			"lumenhq/lumen",
			509,
			"change-request.updated",
			new Date(t0.getTime() + 180_000),
		);
		const base = {
			eventId: opened,
			repoFullName: "lumenhq/lumen",
			workflowSnapshot: [],
		};
		await db.insert(runs).values([
			{
				...base,
				id: generateId(),
				subjectNumber: 400,
				status: "completed",
				backfill: true,
				createdAt: new Date(t0.getTime() - 60_000),
			},
			{
				...base,
				id: generateId(),
				subjectNumber: 508,
				status: "running",
				createdAt: new Date(t0.getTime() - 1000),
			},
			{
				...base,
				id: generateId(),
				subjectNumber: 509,
				status: "paused",
				verdict: "needs_review",
				createdAt: t0,
			},
			{
				...base,
				id: generateId(),
				subjectNumber: 509,
				status: "completed",
				createdAt: new Date(t0.getTime() + 1000),
			},
		]);
		await db.insert(organizationResponseDefaults).values({
			id: generateId(),
			organizationId: orgId,
			config: {},
		});

		expect(await getRepoSetupFacts(db, { orgId, repoId })).toEqual({
			installed: true,
			armed: true,
			enabledRuleIds: ["account-age"],
			customRulesOn: 0,
			workflowsOn: 0,
			firstCheck: {
				number: 509,
				at: t0.toISOString(),
			},
			nextChangeRequest: 509,
			responsesChosen: true,
			onboardingStarted: false,
			onboardingCompleted: false,
		});
		expect(
			await latestOpenChangeRequest(db, {
				fullName: "lumenhq/lumen",
				forge: "github",
			}),
		).toBe(509);
		await addEvent(
			"lumenhq/lumen",
			512,
			"change-request.opened",
			new Date(t0.getTime() + 240_000),
		);
		expect(
			await latestOpenChangeRequest(db, {
				fullName: "lumenhq/lumen",
				forge: "github",
			}),
		).toBe(512);
	});
});

describe("setup steps a page view completes", () => {
	test("opening responses picks the defaults once and keeps a saved config", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "20",
			owner: "other",
			name: "viewed",
			fullName: "other/viewed",
			installationId: "inst-3",
			orgId: otherOrgId,
		});
		expect(await markResponsesReviewed(db, { orgId, repoId })).toBe(false);
		expect(await markResponsesReviewed(db, { orgId: otherOrgId, repoId })).toBe(
			true,
		);
		expect(await markResponsesReviewed(db, { orgId: otherOrgId, repoId })).toBe(
			false,
		);
		const facts = await getRepoSetupFacts(db, { orgId: otherOrgId, repoId });
		expect(facts?.responsesChosen).toBe(true);
	});
});

describe("onboarding events", () => {
	test("each event is claimed once per repo, completed only after started", async () => {
		const repoId = await repoServices.ensureRepo(db, {
			externalId: "21",
			owner: "lumenhq",
			name: "funnel",
			fullName: "lumenhq/funnel",
			installationId: "inst-1",
			orgId,
		});
		const claim = (event: "started" | "completed", org = orgId) =>
			claimOnboardingEvent(db, { orgId: org, repoId, event });
		expect(await claim("completed")).toBe(false);
		expect(await claim("started", otherOrgId)).toBe(false);
		expect(await claim("started")).toBe(true);
		expect(await claim("started")).toBe(false);
		expect(await claim("completed")).toBe(true);
		expect(await claim("completed")).toBe(false);
		const facts = await getRepoSetupFacts(db, { orgId, repoId });
		expect(facts?.onboardingStarted).toBe(true);
		expect(facts?.onboardingCompleted).toBe(true);
	});
});
