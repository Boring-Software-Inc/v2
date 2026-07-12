import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { activityFeedSchema, DEFAULT_WORKFLOW } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { events } from "../schema/events.ts";
import {
	getActivityForEvent,
	listActivity,
	listActivityFeed,
} from "./events.ts";
import { createRun, recordSteps } from "./runs.ts";

/**
 * §9 activity feed — the events⋈runs join. A gated event carries its run's
 * verdict + the first failing rule's one-liner; an ungated event (a push, an
 * exempt change request) carries no run.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

// A VALID NormalizedEvent per kind — the feed parses against the contract, so
// seed data must be real, not a loose stub.
const NORMALIZED = (id: string, kind: string) => {
	const base = {
		id,
		forge: "github" as const,
		deliveryId: `d-${id}`,
		repo: { owner: "acme", name: "x", fullName: "acme/x" },
		repoExternalId: "1",
		actor: { login: "sockpuppet", externalId: "3", avatarUrl: undefined },
		occurredAt: "2026-07-12T00:00:00.000Z",
		receivedAt: "2026-07-12T00:00:00.000Z",
		kind,
	};
	if (kind === "push") {
		return {
			...base,
			push: { ref: "refs/heads/f", headSha: "abc", commitCount: 1 },
		};
	}
	return {
		...base,
		changeRequest: {
			number: 1,
			title: "t",
			headSha: "abc",
			baseRef: "main",
			headRef: "f",
			draft: false,
			url: "https://github.com/acme/x/pull/1",
		},
	};
};

async function seedEvent(id: string, kind: string): Promise<void> {
	await db.insert(events).values({
		id,
		deliveryId: `d-${id}`,
		rawKind: "pull_request",
		raw: {},
		kind,
		repoFullName: "acme/x",
		actorLogin: "sockpuppet",
		normalized: NORMALIZED(id, kind),
		normalizedAt: new Date(),
	});
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("listActivity — events joined to runs", () => {
	test("a gated event carries its run verdict + leading fail reason", async () => {
		await seedEvent("evt-run", "change-request.opened");
		const runId = await createRun(db, {
			eventId: "evt-run",
			repoFullName: "acme/x",
			subjectNumber: 1,
			headSha: "abc",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "block",
		});
		const at = "2026-07-12T00:00:00.000Z";
		await recordSteps(db, runId, [
			{
				nodeId: "default@1:crypto",
				nodeKind: "rule",
				ruleRef: "crypto-address@1",
				status: "fail",
				input: {},
				output: {
					ruleId: "crypto-address",
					version: 1,
					status: "evaluated",
					passed: false,
					evidence: { matches: [] },
					evaluatedAt: at,
				},
				summary: "found 2 crypto addresses in DONATE.md",
				startedAt: at,
				finishedAt: at,
				durationMs: 1,
			},
		]);

		const page = await listActivity(db, {});
		const row = page.items.find((i) => i.event.id === "evt-run");
		expect(row?.run?.verdict).toBe("block");
		expect(row?.run?.status).toBe("completed");
		expect(row?.run?.reason).toBe("found 2 crypto addresses in DONATE.md");
		expect(row?.run?.runId).toBe(runId);
	});

	test("an ungated event carries no run", async () => {
		await seedEvent("evt-none", "push");
		const row = await getActivityForEvent(db, "evt-none");
		expect(row?.run).toBeNull();
		expect(row?.event.id).toBe("evt-none");
	});

	test("getActivityForEvent returns null for an unknown event", async () => {
		expect(await getActivityForEvent(db, "nope")).toBeNull();
	});
});

/**
 * §9 grouped feed — the wire shape crosses to the client, so the row mapping is
 * load-bearing: `db.execute()` returns timestamptz as an ISO STRING (not a
 * Date), so the query MUST map explicitly or a downstream `.toISOString()`
 * explodes. This asserts the output parses clean against the contract schema and
 * that timestamps are correctly typed.
 */
describe("listActivityFeed — grouped by change request", () => {
	// A VALID NormalizedEvent (parses against the contract) — the feed schema
	// includes normalizedEventSchema, so the seed must be real, not a loose stub.
	const changeRequest = (id: string, kind: string) => ({
		id,
		forge: "github" as const,
		deliveryId: `d-${id}`,
		repo: { owner: "acme", name: "y", fullName: "acme/y" },
		repoExternalId: "9",
		actor: { login: "octocat", externalId: "5", avatarUrl: undefined },
		occurredAt: "2026-07-12T00:00:00.000Z",
		receivedAt: "2026-07-12T00:00:00.000Z",
		kind,
		changeRequest: {
			number: 7,
			title: "fix typo",
			headSha: "deadbeef",
			baseRef: "main",
			headRef: "fix",
			draft: false,
			url: "https://github.com/acme/y/pull/7",
		},
	});

	const installation = (id: string) => ({
		id,
		forge: "github" as const,
		deliveryId: `d-${id}`,
		actor: { login: "octocat", externalId: "5" },
		occurredAt: "2026-07-12T01:00:00.000Z",
		receivedAt: "2026-07-12T01:00:00.000Z",
		kind: "installation.created",
		installation: { externalId: "42", account: "acme" },
		repositories: [],
	});

	async function seedGrouped(
		id: string,
		normalized: Record<string, unknown>,
		opts: { subjectNumber: number | null; repoFullName: string | null },
	): Promise<void> {
		await db.insert(events).values({
			id,
			deliveryId: `d-${id}`,
			rawKind: "pull_request",
			raw: {},
			kind: String(normalized.kind),
			repoFullName: opts.repoFullName,
			subjectNumber: opts.subjectNumber,
			actorLogin: "octocat",
			normalized,
			normalizedAt: new Date(),
		});
	}

	test("collapses a change request into one group with a typed timestamp", async () => {
		await seedGrouped(
			"feed-open",
			changeRequest("feed-open", "change-request.opened"),
			{
				subjectNumber: 7,
				repoFullName: "acme/y",
			},
		);
		await seedGrouped(
			"feed-update",
			changeRequest("feed-update", "change-request.updated"),
			{ subjectNumber: 7, repoFullName: "acme/y" },
		);
		const runId = await createRun(db, {
			eventId: "feed-update",
			repoFullName: "acme/y",
			subjectNumber: 7,
			headSha: "deadbeef",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "block",
		});
		const at = "2026-07-12T00:00:00.000Z";
		await recordSteps(db, runId, [
			{
				nodeId: "default@1:age",
				nodeKind: "rule",
				ruleRef: "account-age@1",
				status: "fail",
				input: {},
				output: {
					ruleId: "account-age",
					version: 1,
					status: "evaluated",
					passed: false,
					evidence: { accountAgeDays: 2 },
					evaluatedAt: at,
				},
				summary: "your account is 2 days old",
				startedAt: at,
				finishedAt: at,
				durationMs: 1,
			},
		]);
		await seedGrouped("feed-install", installation("feed-install"), {
			subjectNumber: null,
			repoFullName: null,
		});

		const feed = await listActivityFeed(db, { limit: 50 });

		// Parses clean against the contract wire schema — the loud boundary.
		expect(() => activityFeedSchema.parse(feed)).not.toThrow();

		const group = feed.items.find(
			(i) => i.type === "group" && i.group.subjectNumber === 7,
		);
		if (group?.type !== "group") {
			throw new Error("expected a group for #7");
		}
		expect(group.group.repoFullName).toBe("acme/y");
		expect(group.group.currentVerdict).toBe("block");
		expect(group.group.eventCount).toBe(2);
		// The timestamp is a real ISO string, not a Date coerced to "[object …]".
		expect(typeof group.group.latestActivityAt).toBe("string");
		expect(Number.isNaN(Date.parse(group.group.latestActivityAt))).toBe(false);
		const reason = group.group.timeline.find((t) => t.run)?.run?.reason;
		expect(reason).toBe("your account is 2 days old");

		// The standalone (subject_number IS NULL) installation event is present.
		const standalone = feed.items.find(
			(i) =>
				i.type === "event" && i.entry.event.kind === "installation.created",
		);
		expect(standalone).toBeDefined();
	});
});
