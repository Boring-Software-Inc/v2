import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	activityFeedSchema,
	DEFAULT_WORKFLOW,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { sql } from "drizzle-orm";
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
		const row = page.items.find((i) => i.eventId === "evt-run");
		expect(row?.run?.verdict).toBe("block");
		expect(row?.run?.status).toBe("completed");
		expect(row?.run?.reason).toBe("found 2 crypto addresses in DONATE.md");
		expect(row?.run?.runId).toBe(runId);
	});

	test("an ungated event carries no run", async () => {
		await seedEvent("evt-none", "push");
		const row = await getActivityForEvent(db, "evt-none");
		expect(row?.run).toBeNull();
		expect(row?.event?.id).toBe("evt-none");
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

	// A repo-scoped standalone (no change request): a push to acme/y.
	const push = (id: string) => ({
		id,
		forge: "github" as const,
		deliveryId: `d-${id}`,
		repo: { owner: "acme", name: "y", fullName: "acme/y" },
		repoExternalId: "9",
		actor: { login: "octocat", externalId: "5", avatarUrl: undefined },
		occurredAt: "2026-07-12T01:00:00.000Z",
		receivedAt: "2026-07-12T01:00:00.000Z",
		kind: "push",
		push: { ref: "refs/heads/main", headSha: "cafe", commitCount: 1 },
	});

	async function seedGrouped(
		id: string,
		normalized: ReturnType<typeof changeRequest | typeof push>,
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

	test("latest run wins when an event has multiple runs (re-run path)", async () => {
		await seedGrouped(
			"multi-run-event",
			changeRequest("multi-run-event", "change-request.opened"),
			{ subjectNumber: 42, repoFullName: "acme/y" },
		);
		const first = await createRun(db, {
			eventId: "multi-run-event",
			repoFullName: "acme/y",
			subjectNumber: 42,
			headSha: "aaa",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "pass",
		});
		// Second run on the SAME event — the re-run materialization path.
		await new Promise((r) => setTimeout(r, 5));
		const second = await createRun(db, {
			eventId: "multi-run-event",
			repoFullName: "acme/y",
			subjectNumber: 42,
			headSha: "bbb",
			snapshot: [DEFAULT_WORKFLOW],
			status: "completed",
			verdict: "block",
			triggeredBy: "admin-1",
		});
		const feed = await listActivityFeed(db, {
			repo: { forge: "github", fullName: "acme/y" },
		});
		const group = feed.items.find(
			(i) => i.type === "group" && i.group.subjectNumber === 42,
		);
		expect(group?.type).toBe("group");
		if (group?.type !== "group") {
			return;
		}
		expect(group.group.currentVerdict).toBe("block");
		expect(group.group.currentRunId).toBe(second);
		expect(group.group.currentRunId).not.toBe(first);

		const row = await getActivityForEvent(db, "multi-run-event");
		expect(row?.run?.runId).toBe(second);
		expect(row?.run?.verdict).toBe("block");
	});

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
		await seedGrouped("feed-push", push("feed-push"), {
			subjectNumber: null,
			repoFullName: "acme/y",
		});

		const feed = await listActivityFeed(db, {
			repo: { forge: "github", fullName: "acme/y" },
			limit: 50,
		});

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
		expect(group.group.latestActivityAt).toBeString();
		expect(Number.isNaN(Date.parse(group.group.latestActivityAt))).toBe(false);
		const reason = group.group.timeline.find((t) => t.run)?.run?.reason;
		expect(reason).toBe("your account is 2 days old");

		// The repo-scoped standalone (subject_number IS NULL) push is present.
		const standalone = feed.items.find(
			(i) => i.type === "event" && i.entry.event?.kind === "push",
		);
		expect(standalone).toBeDefined();
	});
});

describe("invalid persisted historical activity", () => {
	test("mixed malformed rows remain visible and never poison valid history or nested extras", async () => {
		const malformed = [
			null,
			false,
			0,
			"historical",
			[],
			{ kind: "push" },
			{ kind: "change-request.opened", actor: null },
		];
		for (const [index, normalized] of malformed.entries()) {
			const id = `history-invalid-${index}`;
			await db.insert(events).values({
				id,
				deliveryId: id,
				rawKind: "pull_request",
				raw: {},
				kind: "change-request.opened",
				repoFullName: "history/mixed",
				subjectNumber: 91,
				normalized: normalized === null ? sql`'null'::jsonb` : normalized,
				normalizedAt: new Date(),
				receivedAt: new Date(`2026-07-12T00:00:0${index}.000Z`),
			});
			const row = await getActivityForEvent(db, id);
			expect(row).toMatchObject({
				eventId: id,
				event: null,
				unavailableReason: "Historical event data is unavailable",
				run: null,
			});
		}
		const fixture = normalizedEventSchema.parse(
			await Bun.file(
				new URL(
					"../../../core/fixtures/change-request.opened.event.json",
					import.meta.url,
				),
			).json(),
		);
		const normalized = {
			...fixture,
			id: "history-valid",
			extra: [null, { kept: true }],
			actor: { ...fixture.actor, extra: { kept: "nested" } },
		};
		await db.insert(events).values({
			id: normalized.id,
			deliveryId: normalized.id,
			rawKind: "pull_request",
			raw: {},
			kind: normalized.kind,
			repoFullName: "history/mixed",
			subjectNumber: 91,
			normalized,
			normalizedAt: new Date(),
			receivedAt: new Date("2026-07-12T00:00:07.000Z"),
		});
		expect((await getActivityForEvent(db, normalized.id))?.event).toEqual(
			normalized,
		);
		const page = await listActivity(db, { limit: 100 });
		expect(
			page.items.filter((entry) => entry.eventId.startsWith("history-invalid-"))
				.length,
		).toBe(malformed.length);
		const feed = activityFeedSchema.parse(
			await listActivityFeed(db, {
				repo: { forge: "github", fullName: "history/mixed" },
			}),
		);
		const item = feed.items[0];
		expect(item?.type).toBe("group");
		if (item?.type !== "group") throw new Error("expected historical group");
		expect(item.group.eventCount).toBe(8);
		expect(item.group.timeline.map((entry) => entry.eventId)).toEqual([
			...malformed.map((_, index) => `history-invalid-${index}`),
			normalized.id,
		]);
		expect(
			item.group.timeline.filter((entry) => entry.event === null),
		).toHaveLength(7);
		expect(item.group.timeline.at(-1)?.event).toEqual(normalized);
		expect(item.group.actor.login).toBe(fixture.actor.login);
		expect(item.group.latestActivityAt).toBe("2026-07-12T00:00:07.000Z");
	});
});

test("unavailable event bodies preserve real run summaries, with valid body kind taking precedence", async () => {
	const cases = [
		{
			id: "history-real-block",
			columnKind: "change-request.opened",
			normalized: { kind: "push" },
			run: true,
			verdict: "block",
		},
		{
			id: "history-no-run",
			columnKind: "change-request.opened",
			normalized: { kind: "push" },
			run: false,
			verdict: null,
		},
		{
			id: "history-unknown-kind",
			columnKind: "unknown-history",
			normalized: { kind: "push" },
			run: true,
			verdict: null,
		},
		{
			id: "history-valid-push",
			columnKind: "change-request.opened",
			normalized: NORMALIZED("history-valid-push", "push"),
			run: true,
			verdict: null,
		},
	];
	for (const [index, entry] of cases.entries()) {
		const subjectNumber = index + 100;
		await db.insert(events).values({
			id: entry.id,
			deliveryId: entry.id,
			rawKind: "pull_request",
			raw: {},
			kind: entry.columnKind,
			repoFullName: "history/verdict",
			subjectNumber,
			normalized: entry.normalized,
			normalizedAt: new Date(),
		});
		const runId = entry.run
			? await createRun(db, {
					eventId: entry.id,
					repoFullName: "history/verdict",
					subjectNumber,
					headSha: "head",
					snapshot: [DEFAULT_WORKFLOW],
					status: "completed",
					verdict: "block",
				})
			: null;
		const feed = await listActivityFeed(db, {
			repo: { forge: "github", fullName: "history/verdict" },
		});
		const item = feed.items.find(
			(item) =>
				item.type === "group" && item.group.subjectNumber === subjectNumber,
		);
		if (item?.type !== "group") throw new Error("expected historical group");
		expect(item.group.currentVerdict).toBe(entry.verdict);
		expect(item.group.currentRunId).toBe(entry.verdict ? runId : null);
		expect(item.group.timeline[0]?.run?.runId ?? null).toBe(runId);
		if (entry.id !== "history-valid-push")
			expect(item.group.timeline[0]).toMatchObject({
				event: null,
				unavailableReason: "Historical event data is unavailable",
			});
		else expect(item.group.timeline[0]?.event?.kind).toBe("push");
	}
});

test("an unavailable historical header uses only a validated verdict title", async () => {
	const cases = [
		{
			kind: "change-request.opened",
			title: "original title",
			expected: "original title",
		},
		{ kind: "change-request.opened", title: 23, expected: "#201" },
		{ kind: "push", title: "unrelated extra", expected: "#202" },
	];
	for (const [index, entry] of cases.entries()) {
		const id = `history-title-${index}`;
		await db.insert(events).values({
			id,
			deliveryId: id,
			rawKind: "pull_request",
			raw: {},
			kind: entry.kind,
			repoFullName: "history/titles",
			subjectNumber: 200 + index,
			normalized: { kind: entry.kind, changeRequest: { title: entry.title } },
			normalizedAt: new Date(),
		});
		const feed = await listActivityFeed(db, {
			repo: { forge: "github", fullName: "history/titles" },
		});
		const item = feed.items.find(
			(item) =>
				item.type === "group" && item.group.subjectNumber === 200 + index,
		);
		if (item?.type !== "group") throw new Error("expected historical group");
		expect(item.group.title).toBe(entry.expected);
		expect(item.group.timeline[0]).toMatchObject({
			event: null,
			unavailableReason: "Historical event data is unavailable",
			run: null,
		});
		expect(item.group.url).toBeNull();
	}
});
