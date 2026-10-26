import { describe, expect, test } from "bun:test";
import type { DigestRepo } from "@tripwire/contracts";
import { aggregateHomeDigest } from "#/lib/home-digest";

const FROM = new Date("2026-10-17T12:00:00.000Z");
const TO = new Date("2026-10-24T12:00:00.000Z");

function repo(overrides: Partial<DigestRepo> = {}): DigestRepo {
	return {
		id: "lumen",
		name: "lumen",
		fullName: "lumenhq/lumen",
		counts: [
			{ verdict: "block", count: 3 },
			{ verdict: "needs_review", count: 2 },
			{ verdict: "pass", count: 9 },
		],
		latestRuns: [
			{ number: 521, verdict: "pass", createdAt: "2026-10-23T12:00:00.000Z" },
		],
		uninstalledRuleIds: ["crypto-address"],
		preview: {
			windowDays: 30,
			changeRequests: 1,
			recent: [
				{ number: 521, title: "Update funding links", author: "contributor" },
			],
			rules: [{ ruleId: "crypto-address", caught: [521], examples: [] }],
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
				{ number: 521, verdict: "pass", createdAt: "2026-10-24T11:00:00.000Z" },
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
							{ number: 521, verdict, createdAt: "2026-10-23T12:00:00.000Z" },
						],
					}),
				],
				FROM,
				TO,
			).caught,
		).toBeNull();
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
				[repo({ latestRuns: [{ number: 521, verdict: "pass", createdAt }] })],
				FROM,
				TO,
			).caught,
		).toBeNull();
	});
});
