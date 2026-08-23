import { describe, expect, test } from "bun:test";
import type { CustomRuleRecord, RepoScopedEvent } from "@tripwire/contracts";
import { GithubHttp } from "@tripwire/forge-github";
import { createForgeSignalCtx } from "@tripwire/sdk";
import { customRuleSource, evaluateCustomRule } from "./custom-rules.ts";

/**
 * The Phase 2 round-trip gate: author -> store JSON -> load -> synthesize ->
 * evaluateSignalRule -> the same RuleResult envelope a built-in produces.
 */

const NOW = "2026-07-22T12:00:00.000Z";

const prEvent: RepoScopedEvent = {
	id: "evt-1",
	forge: "github",
	deliveryId: "d-1",
	repo: { owner: "acme", name: "widgets", fullName: "acme/widgets" },
	actor: { login: "mallory", externalId: "77" },
	occurredAt: NOW,
	receivedAt: NOW,
	kind: "change-request.opened",
	changeRequest: {
		number: 42,
		title: "Add feature",
		headSha: "abc",
		baseRef: "main",
		headRef: "f",
		draft: false,
		url: "https://github.com/acme/widgets/pull/42",
	},
};

function makeSignalCtx(responses: Record<string, unknown>) {
	const calls: string[] = [];
	const http = new GithubHttp({
		tokenFor: async () => "t",
		fetchImpl: (async (input: string | URL | Request) => {
			const path = String(input).replace("https://api.github.com", "");
			calls.push(path);
			const body = responses[path];
			return body === undefined
				? new Response("nope", { status: 404 })
				: Response.json(body);
		}) as unknown as typeof fetch,
	});
	return {
		ctx: createForgeSignalCtx({ forge: http, event: prEvent, now: NOW }),
		calls,
	};
}

/** Author in code, store as JSON, load like a db row would. */
function storedRule(
	definition: CustomRuleRecord["definition"],
): CustomRuleRecord {
	const row = JSON.parse(
		JSON.stringify({
			id: "custom-gist-floor",
			name: "gist floor",
			enabled: true,
			definition,
		}),
	);
	const source = customRuleSource([row], null);
	const record = source.records.get("custom-gist-floor@1");
	if (!record) {
		throw new Error("stored rule did not load");
	}
	return record;
}

describe("custom rule round trip", () => {
	test("a stored JSON rule evaluates to the correct verdict and envelope", async () => {
		const record = storedRule({
			when: { id: "contributor.publicGists" },
			comparison: { kind: "atLeast", args: [3] },
			severity: "low",
		});
		const { ctx } = makeSignalCtx({
			"/users/mallory": {
				id: 77,
				created_at: NOW,
				followers: 0,
				following: 0,
				public_repos: 1,
				public_gists: 2,
				hireable: null,
				company: null,
				location: null,
				bio: null,
			},
		});
		const result = await evaluateCustomRule(record, ctx, NOW);
		// The exact envelope shape a built-in produces, §6.
		expect(result).toEqual({
			ruleId: "custom-gist-floor",
			version: 1,
			status: "evaluated",
			passed: false,
			evidence: { observed: 2 },
			evaluatedAt: NOW,
		});
	});

	test("a windowed custom rule applies the transform through the evaluator", async () => {
		const record = storedRule({
			when: {
				id: "contributor.recentForkTimes",
				transform: { kind: "lastCount", window: "24h" },
			},
			comparison: { kind: "atMost", args: [1] },
			severity: "high",
		});
		const { ctx } = makeSignalCtx({
			"/users/mallory/events?per_page=100&page=1": [
				{ type: "ForkEvent", created_at: "2026-07-22T10:00:00.000Z" },
				{ type: "ForkEvent", created_at: "2026-07-22T08:00:00.000Z" },
				{ type: "ForkEvent", created_at: "2026-07-10T00:00:00.000Z" },
			],
		});
		const result = await evaluateCustomRule(record, ctx, NOW);
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(false);
		expect(result.evidence).toEqual({ observed: 2 });
	});

	test("an unavailable signal skips, never throws", async () => {
		const record = storedRule({
			when: { id: "comment.body", transform: { kind: "letterCount" } },
			comparison: { kind: "atLeast", args: [4] },
			severity: "low",
		});
		const { ctx } = makeSignalCtx({});
		const result = await evaluateCustomRule(record, ctx, NOW);
		expect(result.status).toBe("skipped");
		expect(result.reason).toBe("this event has no comment");
	});

	test("no signal ctx (forge reads off) skips like a built-in on a missing read", async () => {
		const record = storedRule({
			when: { id: "contributor.publicGists" },
			comparison: { kind: "atLeast", args: [1] },
			severity: "low",
		});
		const result = await evaluateCustomRule(record, null, NOW);
		expect(result.status).toBe("skipped");
		expect(result.reason).toBe("forge reads unavailable");
	});

	test("a malformed stored row never loads into the source", () => {
		const source = customRuleSource(
			[
				{
					id: "custom-bad",
					name: "bad",
					enabled: true,
					definition: {
						when: { id: "x" },
						comparison: { kind: "scan", args: [] },
					},
				},
			],
			null,
		);
		expect(source.records.size).toBe(0);
	});

	test("two custom rules on one signal cluster share one fetch", async () => {
		const gists = storedRule({
			when: { id: "contributor.publicGists" },
			comparison: { kind: "atLeast", args: [1] },
			severity: "low",
		});
		const followers: CustomRuleRecord = {
			...gists,
			id: "custom-followers",
			definition: {
				when: { id: "contributor.followers" },
				comparison: { kind: "atLeast", args: [1] },
				severity: "low",
			},
		};
		const { ctx, calls } = makeSignalCtx({
			"/users/mallory": {
				id: 77,
				created_at: NOW,
				followers: 5,
				following: 0,
				public_repos: 1,
				public_gists: 2,
				hireable: null,
				company: null,
				location: null,
				bio: null,
			},
		});
		await evaluateCustomRule(gists, ctx, NOW);
		await evaluateCustomRule(followers, ctx, NOW);
		expect(calls).toHaveLength(1);
	});
});

/**
 * The inversion guard (prod incident): a custom rule states what is ALLOWED —
 * `passed` is true when the comparison holds, uniform with built-ins. Author the
 * ALLOW condition, not the flag condition. "require account age at least 7"
 * must PASS an old account and FAIL a new one; the "flag when" mental model
 * shipped every custom rule doing the exact opposite. A rule that should pass,
 * passes — this class of bug must never be invisible again.
 */
describe("pass = the comparison holds (author the ALLOW condition)", () => {
	const requireAtLeast7 = () =>
		storedRule({
			when: { id: "contributor.accountAge" },
			comparison: { kind: "atLeast", args: [7] },
			severity: "medium",
		});
	const userAgedDays = (days: number) => ({
		"/users/mallory": {
			id: 77,
			created_at: new Date(Date.parse(NOW) - days * 86_400_000).toISOString(),
			followers: 0,
			following: 0,
			public_repos: 0,
			public_gists: 0,
			hireable: null,
			company: null,
			location: null,
			bio: null,
		},
	});

	test("an account that MEETS the requirement passes", async () => {
		const { ctx } = makeSignalCtx(userAgedDays(30));
		const result = await evaluateCustomRule(requireAtLeast7(), ctx, NOW);
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(true);
	});

	test("an account that does NOT meet the requirement fails", async () => {
		const { ctx } = makeSignalCtx(userAgedDays(3));
		const result = await evaluateCustomRule(requireAtLeast7(), ctx, NOW);
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(false);
	});
});
