import { describe, expect, test } from "bun:test";
import {
	type CommentInput,
	checkSummary,
	howDoIFix,
	REVIEW_BODY,
	renderVerdictComment,
	reviewBody,
} from "./comment-render.ts";
import {
	redactCommentReasons,
	redactEvidence,
	redactSummary,
} from "./redact.ts";
import {
	hiddenRedactionItems,
	OPEN_REDACTION,
	REDACTION_ITEMS,
	REDACTION_MAX_LEVEL,
	type RedactionPolicy,
	redactionLevelFor,
	redactionPolicySchema,
	repoRedactionSchema,
	resolveRedaction,
} from "./redaction.ts";
import { DEFAULT_RESPONSE_CONFIG } from "./response.ts";

const REASONS = [
	{
		text: "It adds 2 crypto wallet addresses to the title and DONATE.md.",
		remedy: "revise" as const,
		ruleId: "crypto-address",
	},
	{
		text: "spam surface: crypto airdrop address in a test file",
		remedy: "revise" as const,
		ruleId: "ai-review",
	},
	{
		text: "Your account is 2 days old.",
		remedy: "wait" as const,
		waitHint: "This clears in 5 days.",
		ruleId: "account-age",
	},
];

const INPUT: CommentInput = {
	verdict: "block",
	contributorLogin: "g-r-i-m",
	reasons: REASONS,
	runUrl: "https://tripwire.sh/runs/0198abcd",
};

function policy(level: number, extra: Partial<RedactionPolicy> = {}) {
	return redactionPolicySchema.parse({ level, ...extra });
}

describe("redaction ladder", () => {
	test("nine stops, one hidden item per stop", () => {
		expect(REDACTION_MAX_LEVEL).toBe(8);
		expect(hiddenRedactionItems(0)).toEqual([]);
		expect(hiddenRedactionItems(3)).toEqual([
			"matched-values",
			"file-paths",
			"ai-trace",
		]);
		expect(hiddenRedactionItems(8)).toEqual([...REDACTION_ITEMS]);
	});

	test("open by default with every surface but webhooks", () => {
		expect(OPEN_REDACTION).toEqual({
			level: 0,
			surfaces: ["run-page", "check", "comment", "review"],
			showHelp: true,
		});
	});

	test("a surface left out of the policy stays open", () => {
		const p = policy(6, { surfaces: ["comment"] });
		expect(redactionLevelFor(p, "comment")).toBe(6);
		expect(redactionLevelFor(p, "check")).toBe(0);
		expect(redactionLevelFor(p, "webhook")).toBe(0);
	});
});

describe("resolveRedaction", () => {
	const orgDefault = policy(5);

	test("an inheriting repo takes the org default", () => {
		expect(resolveRedaction(repoRedactionSchema.parse({}), orgDefault)).toEqual(
			orgDefault,
		);
	});

	test("an inheriting repo without an org default stays open", () => {
		expect(resolveRedaction(repoRedactionSchema.parse({}), null)).toEqual(
			OPEN_REDACTION,
		);
	});

	test("an override ignores the org default", () => {
		const repo = repoRedactionSchema.parse({ inherit: false, level: 2 });
		expect(resolveRedaction(repo, orgDefault)).toEqual(policy(2));
	});

	test("the repo config default inherits", () => {
		expect(DEFAULT_RESPONSE_CONFIG.redaction.inherit).toBe(true);
	});
});

describe("redactSummary", () => {
	test("level 0 keeps every summary", () => {
		expect(redactSummary("crypto-address@1", "x in DONATE.md", 0)).toBe(
			"x in DONATE.md",
		);
	});

	test("a summary that names files falls back to the rule label at stop 2", () => {
		expect(redactSummary("crypto-address@1", "x in DONATE.md", 1)).toBe(
			"x in DONATE.md",
		);
		expect(redactSummary("crypto-address@1", "x in DONATE.md", 2)).toBe(
			"This change request contains a cryptocurrency wallet address.",
		);
	});

	test("the AI summary falls back at stop 4", () => {
		expect(redactSummary("ai-review@2", "spam surface", 3)).toBe(
			"spam surface",
		);
		expect(redactSummary("ai-review@2", "spam surface", 4)).toBe(
			"An AI review found problems in this change request.",
		);
	});

	test("stop 5 drops every reason", () => {
		expect(redactSummary("account-age@1", "2 days old", 4)).toBe("2 days old");
		expect(redactSummary("account-age@1", "2 days old", 5)).toBeNull();
	});
});

describe("redactCommentReasons", () => {
	test("reasons below stop 5, with leaking summaries swapped for labels", () => {
		const redacted = redactCommentReasons(REASONS, 4);
		expect(redacted.kind).toBe("reasons");
		if (redacted.kind === "reasons") {
			expect(redacted.reasons.map((r) => r.text)).toEqual([
				"this change request contains a cryptocurrency wallet address.",
				"an AI review found problems in this change request.",
				"Your account is 2 days old.",
			]);
		}
	});

	test("rule names at stop 5, a count at 6 and 7, the verdict at 8", () => {
		expect(redactCommentReasons(REASONS, 5)).toEqual({
			kind: "names",
			names: ["Crypto address", "AI review", "Account age"],
		});
		expect(redactCommentReasons(REASONS, 6)).toEqual({
			kind: "count",
			count: 3,
		});
		expect(redactCommentReasons(REASONS, 7)).toEqual({
			kind: "count",
			count: 3,
		});
		expect(redactCommentReasons(REASONS, 8)).toEqual({ kind: "verdict" });
	});
});

describe("redactEvidence", () => {
	const crypto = {
		matches: [{ kind: "eth", value: "0xdEaD", location: "DONATE.md" }],
	};

	test("stop 1 drops matched values, stop 2 drops paths, stop 3 drops it all", () => {
		expect(redactEvidence("crypto-address@1", crypto, 0)).toEqual(crypto);
		expect(redactEvidence("crypto-address@1", crypto, 1)).toEqual({
			matches: [{ kind: "eth", location: "DONATE.md" }],
		});
		expect(redactEvidence("crypto-address@1", crypto, 2)).toEqual({
			matches: [{ kind: "eth" }],
		});
		expect(redactEvidence("crypto-address@1", crypto, 3)).toBeNull();
	});

	test("ai review findings lose their notes, then their files", () => {
		const ai = {
			output: {
				summary: "spam",
				findings: [{ severity: "warn", file: "a.ts", line: 3, note: "`0x1`" }],
			},
		};
		expect(redactEvidence("ai-review@2", ai, 2)).toEqual({
			output: { summary: "spam", findings: [{ severity: "warn" }] },
		});
	});

	test("rules without sensitive fields keep evidence until stop 3", () => {
		const age = { accountAgeDays: 2 };
		expect(redactEvidence("account-age@1", age, 2)).toEqual(age);
		expect(redactEvidence("account-age@1", age, 3)).toBeNull();
	});
});

describe("redacted GitHub surfaces", () => {
	const render = (p: RedactionPolicy) =>
		renderVerdictComment(INPUT, DEFAULT_RESPONSE_CONFIG, p);

	test("open policy renders exactly as before", () => {
		expect(render(OPEN_REDACTION)).toBe(
			renderVerdictComment(INPUT, DEFAULT_RESPONSE_CONFIG),
		);
	});

	test("stop 5 names the rules without reasons", () => {
		const body = render(policy(5));
		expect(body).toContain(
			"It did not meet these rules: Crypto address, AI review and Account age.",
		);
		expect(body).not.toContain("DONATE.md");
		expect(body).not.toContain("spam surface");
	});

	test("stop 6 counts, stop 8 only states the verdict", () => {
		expect(render(policy(6))).toContain("It did not meet 3 rules.");
		expect(render(policy(6))).not.toContain("Crypto address");
		const verdictOnly = render(policy(8));
		expect(verdictOnly).toContain("Tripwire blocked this.");
		expect(verdictOnly).not.toContain("did not meet");
	});

	test("help sections follow their own switch", () => {
		expect(render(policy(0))).toContain(howDoIFix(REASONS));
		const bare = render(policy(0, { showHelp: false }));
		expect(bare).not.toContain("<details>");
	});

	test("the comment surface can be left open", () => {
		expect(render(policy(8, { surfaces: ["check"] }))).toBe(
			render(OPEN_REDACTION),
		);
	});

	test("check summary redacts by level; the review carries no detail", () => {
		expect(checkSummary("block", REASONS, false, 0)).toContain("DONATE.md");
		expect(checkSummary("block", REASONS, false, 2)).toBe(
			"Blocked. This change request contains a cryptocurrency wallet address.",
		);
		expect(checkSummary("block", REASONS, false, 6)).toBe(
			"Blocked. It did not meet 3 rules.",
		);
		expect(checkSummary("block", REASONS, false, 8)).toBe("Blocked.");
		expect(reviewBody(true)).toBe(REVIEW_BODY);
	});
});

describe("every redaction level renders one compact comment", () => {
	for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
		test(`level ${level}`, () => {
			const body = renderVerdictComment(
				INPUT,
				DEFAULT_RESPONSE_CONFIG,
				policy(level),
			);
			expect(body.split("\n")[0]).toBe("@g-r-i-m, Tripwire blocked this.");
			expect(body).toContain('<a href="https://tripwire.sh/runs/0198abcd">');
			expect(body).not.toContain("What is Tripwire?");
			if (level >= 5) {
				expect(body).not.toContain("DONATE.md");
				expect(body).not.toMatch(/^- /m);
			}
			if (level >= 6) {
				expect(body).not.toContain("Crypto address");
			}
			expect(body).toMatchSnapshot();
		});
	}
});
