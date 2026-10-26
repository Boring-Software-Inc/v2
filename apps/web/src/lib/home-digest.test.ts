import { describe, expect, test } from "bun:test";
import type { DigestRepo } from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { aggregateHomeDigest } from "#/lib/home-digest";

const FROM = new Date("2026-10-17T12:00:00.000Z");
const TO = new Date("2026-10-24T12:00:00.000Z");
const EVENT_ID = generateId();

function repo(overrides: Partial<DigestRepo> = {}): DigestRepo {
	return {
		id: "lumen",
		name: "lumen",
		fullName: "lumenhq/lumen",
		armed: true,
		counts: [
			{ verdict: "block", count: 3 },
			{ verdict: "needs_review", count: 2 },
			{ verdict: "pass", count: 9 },
		],
		latestRuns: [
			{
				number: 521,
				eventId: EVENT_ID,
				verdict: "pass",
				createdAt: "2026-10-23T12:00:00.000Z",
			},
		],
		uninstalledRuleIds: ["crypto-address"],
		preview: {
			windowDays: 30,
			changeRequests: 1,
			recent: [
				{ number: 521, title: "Update funding links", author: "contributor" },
			],
			rules: [
				{
					ruleId: "crypto-address",
					caught: [521],
					examples: [],
					caughtEvents: [{ number: 521, eventId: EVENT_ID }],
				},
			],
		},
		...overrides,
	};
}

describe("home digest", () => {
	test("aggregates run verdicts across all repos and includes optional nonzero verdicts", () => {
		const digest = aggregateHomeDigest(
			[
				repo(),
				repo({
					id: "docs",
					name: "docs",
					counts: [
						{ verdict: "pass", count: 4 },
						{ verdict: "changes_required", count: 1 },
						{ verdict: "close", count: 2 },
					],
				}),
			],
			FROM,
			TO,
		);
		expect(digest.total).toBe(21);
		expect(digest.counts).toEqual([
			{ verdict: "block", count: 3 },
			{ verdict: "changes_required", count: 1 },
			{ verdict: "needs_review", count: 2 },
			{ verdict: "pass", count: 13 },
			{ verdict: "close", count: 2 },
		]);
		expect(digest.repos).toHaveLength(2);
	});

	test("keeps the three board verdicts at zero, omitting zero changes needed and closed", () => {
		const digest = aggregateHomeDigest([repo({ counts: [] })], FROM, TO);
		expect(digest.total).toBe(0);
		expect(digest.counts).toEqual([
			{ verdict: "block", count: 0 },
			{ verdict: "needs_review", count: 0 },
			{ verdict: "pass", count: 0 },
		]);
		expect(aggregateHomeDigest([], FROM, TO).total).toBe(0);
	});

	test("reuses stored replay catches and the individual rule name", () => {
		expect(aggregateHomeDigest([repo()], FROM, TO).caught).toEqual({
			repoId: "lumen",
			repoName: "lumen",
			armed: true,
			number: 521,
			title: "Update funding links",
			ruleId: "crypto-address",
			ruleName: "Crypto address",
			url: "https://github.com/lumenhq/lumen/pull/521",
		});
	});

	test("picks the latest passing run across repos, rather than preview order or PR number", () => {
		const newest = repo({
			id: "docs",
			name: "docs",
			fullName: "lumenhq/docs",
			latestRuns: [
				{
					number: 521,
					eventId: EVENT_ID,
					verdict: "pass",
					createdAt: "2026-10-24T11:00:00.000Z",
				},
			],
		});
		expect(aggregateHomeDigest([newest, repo()], FROM, TO).caught?.repoId).toBe(
			"docs",
		);
	});

	test.each([
		"block",
		"needs_review",
		"changes_required",
		"close",
		null,
	] as const)("does not claim the latest %s verdict got through", (verdict) => {
		expect(
			aggregateHomeDigest(
				[
					repo({
						latestRuns: [
							{
								number: 521,
								eventId: EVENT_ID,
								verdict,
								createdAt: "2026-10-23T12:00:00.000Z",
							},
						],
					}),
				],
				FROM,
				TO,
			).caught,
		).toBeNull();
	});

	test("omits historical catches from a different event, even for the same PR", () => {
		const historical = repo();
		const rule = historical.preview?.rules[0];
		if (!rule) throw new Error("missing preview rule");
		rule.caughtEvents = [{ number: 521, eventId: generateId() }];
		expect(aggregateHomeDigest([historical], FROM, TO).caught).toBeNull();
	});

	test("omits legacy previews whose catch event cannot be proven", () => {
		const legacy = repo();
		if (!legacy.preview) throw new Error("missing preview");
		delete legacy.preview.rules[0]?.caughtEvents;
		expect(aggregateHomeDigest([legacy], FROM, TO).caught).toBeNull();
	});

	test("uses a proven rule even when an earlier replay rule only caught another event", () => {
		const mixed = repo({
			uninstalledRuleIds: ["account-age", "crypto-address"],
			armed: false,
		});
		if (!mixed.preview) throw new Error("missing preview");
		mixed.preview.rules.unshift({
			ruleId: "account-age",
			caught: [521],
			examples: [],
			caughtEvents: [{ number: 521, eventId: generateId() }],
		});
		expect(aggregateHomeDigest([mixed], FROM, TO).caught).toMatchObject({
			ruleId: "crypto-address",
			armed: false,
		});
	});

	test("hides absent replay, unknown catches, unobserved PRs, and installed rules", () => {
		for (const overrides of [
			{ preview: null },
			{ uninstalledRuleIds: [] },
			{ latestRuns: [] },
			{
				preview: {
					windowDays: 30,
					changeRequests: 1,
					recent: [
						{
							number: 521,
							title: "Update funding links",
							author: "contributor",
						},
					],
					rules: [{ ruleId: "crypto-address", caught: null, examples: [] }],
				},
			},
		]) {
			expect(
				aggregateHomeDigest([repo(overrides)], FROM, TO).caught,
			).toBeNull();
		}
	});

	test.each([
		"2026-10-17T11:59:59.999Z",
		"2026-10-24T12:00:00.001Z",
	])("does not recommend a catch outside the week: %s", (createdAt) => {
		expect(
			aggregateHomeDigest(
				[
					repo({
						latestRuns: [
							{ number: 521, eventId: EVENT_ID, verdict: "pass", createdAt },
						],
					}),
				],
				FROM,
				TO,
			).caught,
		).toBeNull();
	});
});

test("carries the repo off state into the install recommendation", () => {
	expect(
		aggregateHomeDigest([repo({ armed: false })], FROM, TO).caught?.armed,
	).toBe(false);
});
