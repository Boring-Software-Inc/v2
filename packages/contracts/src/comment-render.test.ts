import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
	COMMENT_MARKER,
	type CommentInput,
	type CommentReason,
	checkSummary,
	planSurfaces,
	REASON_LIMIT,
	REVIEW_POINTER,
	renderCommentBody,
	renderSoleReview,
	renderVerdictComment,
	type SurfacePlan,
} from "./comment-render.ts";
import {
	REDACTION_MAX_LEVEL,
	type RedactionPolicy,
	redactionPolicySchema,
} from "./redaction.ts";
import {
	type BlockCommentMode,
	DEFAULT_RESPONSE_CONFIG,
	type ResponseConfig,
	responseConfigSchema,
	wantsCheck,
	wantsComment,
} from "./response.ts";
import type { Verdict } from "./runs.ts";

type ResponseConfigInput = z.input<typeof responseConfigSchema>;
type OverrideInput = NonNullable<ResponseConfigInput["passComment"]>;

const MARKERS = /<!-- tripwire:[^>]*-->/g;
const RUN_URL = "https://tripwire.sh/runs/0198abcd";
const BADGE = `<a href="${RUN_URL}"><img src="https://tripwire.sh/badges/view-run.png" width="185" alt="View on Tripwire" /></a>`;

const AGE: CommentReason = {
	text: "Your account is 2 days old.",
	remedy: "wait",
	hint: "This clears in 5 days.",
	ruleId: "account-age",
	ruleName: "Account age",
};
const CRYPTO: CommentReason = {
	text: "It adds 2 crypto wallet addresses to DONATE.md.",
	remedy: "revise",
	hint: "Remove the addresses.",
	ruleId: "crypto-address",
	ruleName: "Crypto address",
};
const AI: CommentReason = {
	text: "crypto donation addresses are spam surface with no maintainer value",
	remedy: "revise",
	ruleId: "ai-review",
	ruleName: "AI review",
};
const CUSTOM: CommentReason = {
	text: "Target branch is main.",
	remedy: "revise",
	ruleId: "custom-doesnt-go-to-main-019fa6",
	ruleName: "Doesn't go to main",
};
const FILES: CommentReason = {
	text: "It changes 40 files.",
	remedy: "revise",
	hint: "Split it into smaller change requests.",
	ruleId: "max-files-changed",
	ruleName: "Max files changed",
};
const RATE: CommentReason = {
	text: "You opened 12 change requests in a short time.",
	remedy: "wait",
	hint: "Wait before you open another.",
	ruleId: "pr-rate-limit",
	ruleName: "Rate limit",
};
const HONEYPOT: CommentReason = {
	text: "It changes a protected file.",
	remedy: "revise",
	hint: "Undo your change to that file.",
	ruleId: "honeypot",
	ruleName: "Honeypot paths",
};

const MAIN = [AGE, CRYPTO, AI, CUSTOM];
const MANY = [AGE, CRYPTO, AI, CUSTOM, FILES, RATE, HONEYPOT];

function input(extra: Partial<CommentInput> = {}): CommentInput {
	return {
		verdict: "block",
		contributorLogin: "octocat",
		reasons: MAIN,
		runUrl: RUN_URL,
		...extra,
	};
}

function policy(level: number, extra: Partial<RedactionPolicy> = {}) {
	return redactionPolicySchema.parse({ level, ...extra });
}

function config(extra: ResponseConfigInput = {}): ResponseConfig {
	return responseConfigSchema.parse(extra);
}

function plan(
	extra: Partial<CommentInput> = {},
	level = 0,
	cfg: ResponseConfig = DEFAULT_RESPONSE_CONFIG,
	reviewPosted = true,
	pol: RedactionPolicy = policy(level),
): SurfacePlan {
	return planSurfaces(input(extra), cfg, pol, { reviewPosted });
}

function sentences(text: string | null): string[] {
	if (!text) {
		return [];
	}
	return text
		.replace(MARKERS, "")
		.replace(/<[^>]+>/g, "\n")
		.split(/(?<=[.?!])\s+|\n+/)
		.map((part) => part.replace(/^- /, "").trim())
		.filter((part) => part.length > 0);
}

function itemsOnThePr(p: SurfacePlan): string[] {
	return [
		...(p.comment === "upsert" ? [p.commentBody ?? ""] : []),
		...(p.review ? [p.review] : []),
	];
}

function expectNoRepeats(p: SurfacePlan, check: string) {
	const [first, second] = itemsOnThePr(p);
	const shared = sentences(first ?? null).filter((sentence) =>
		sentences(second ?? null).includes(sentence),
	);
	expect(shared).toEqual([]);
	const review = sentences(p.review);
	expect(
		review.filter((sentence) => sentences(check).includes(sentence)),
	).toEqual([]);
}

describe("the block comment, levels 0 to 4", () => {
	test("every reason names its rule", () => {
		const body = renderVerdictComment(input(), DEFAULT_RESPONSE_CONFIG);
		expect(body).toContain(
			"- **Account age:** Your account is 2 days old. This clears in 5 days.",
		);
		expect(body).toContain(
			"- **Crypto address:** It adds 2 crypto wallet addresses to DONATE.md. Remove the addresses.",
		);
		expect(body).toContain(
			"- **AI review:** Crypto donation addresses are spam surface with no maintainer value.",
		);
		expect(body).toContain("- **Doesn't go to main:** Target branch is main.");
		expect(body).not.toContain("custom-doesnt-go-to-main-019fa6");
		expect(body).toMatchSnapshot();
	});

	test("the run link is the badge button, with the link text as its alt", () => {
		const body = renderVerdictComment(input(), DEFAULT_RESPONSE_CONFIG);
		expect(body).toContain(BADGE);
		expect(body.match(/<a /g)?.length).toBe(1);
	});

	test("one reason renders as a line, not a list", () => {
		const body = renderVerdictComment(
			input({ reasons: [FILES] }),
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain(
			"this change request.\n\n**Max files changed:** It changes 40 files. Split it into smaller change requests.\n\n<a href",
		);
		expect(body).not.toMatch(/^- /m);
		expect(body).toMatchSnapshot();
	});

	test("more reasons than the cap end with how many are left", () => {
		const body = renderVerdictComment(
			input({ reasons: MANY }),
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body.match(/^- \*\*/gm)?.length).toBe(REASON_LIMIT);
		expect(body).toContain("- And 2 more.");
		expect(body).not.toContain("Rate limit");
		expect(body).toMatchSnapshot();
	});

	test("with the link off, every reason stays in the comment", () => {
		const body = renderCommentBody(input({ reasons: MANY }), false);
		expect(body.match(/^- \*\*/gm)?.length).toBe(MANY.length);
		expect(body).not.toContain("And 2 more");
		expect(body).not.toContain("<a href");
	});

	test("only the AI review failed", () => {
		const body = renderVerdictComment(
			input({ reasons: [AI] }),
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain(
			"**AI review:** Crypto donation addresses are spam surface with no maintainer value.",
		);
		expect(body).toMatchSnapshot();
	});

	test("only a custom rule failed", () => {
		const body = renderVerdictComment(
			input({ reasons: [CUSTOM] }),
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain("**Doesn't go to main:** Target branch is main.");
		expect(body).toMatchSnapshot();
	});

	test("a custom rule with no stored name never prints its ref", () => {
		const body = renderVerdictComment(
			input({
				reasons: [{ ...CUSTOM, ruleName: undefined }],
			}),
			DEFAULT_RESPONSE_CONFIG,
			policy(5),
		);
		expect(body).toContain("This rule did not pass: Custom rule.");
		expect(body).not.toContain("custom-doesnt-go-to-main");
	});

	test("a reason with no rule at all still reads as a line", () => {
		const body = renderVerdictComment(
			input({
				reasons: [{ text: "It does not meet this rule.", remedy: "revise" }],
			}),
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain("**Unnamed rule:** It does not meet this rule.");
	});

	test("very long names and reasons stay on one line each and escape markdown", () => {
		const long: CommentReason = {
			text: `${"A very long reason ".repeat(10).trim()}.`,
			remedy: "revise",
			ruleId: "custom-long-019f",
			ruleName: `${"Long*name_".repeat(8)}`.slice(0, 80),
		};
		const body = renderVerdictComment(
			input({ reasons: [long, FILES] }),
			DEFAULT_RESPONSE_CONFIG,
		);
		const line = body.split("\n").find((l) => l.startsWith("- **Long"));
		expect(line).toContain("Long\\*name\\_");
		expect(line?.endsWith("A very long reason.")).toBe(true);
		const named = renderSoleReview(
			input({ reasons: [long, FILES] }),
			DEFAULT_RESPONSE_CONFIG,
			policy(5),
		);
		expect(named).toContain("2 rules did not pass: Long\\*name\\_");
	});

	test("one line per rule uses the contributor label, or the reason when there is none", () => {
		const body = renderVerdictComment(
			input({ reasons: [AGE, CUSTOM] }),
			config({ blockComment: { mode: "one-liner-link" } }),
		);
		expect(body).toContain(
			"- **Account age:** Your account is too new for this repository.",
		);
		expect(body).toContain("- **Doesn't go to main:** Target branch is main.");
		expect(body).not.toContain("<details>");
		expect(body).toMatchSnapshot();
	});

	test("help off drops the help, nothing else", () => {
		const body = renderVerdictComment(
			input(),
			DEFAULT_RESPONSE_CONFIG,
			policy(0, { showHelp: false }),
		);
		expect(body).not.toContain("How do I fix this?");
		expect(body).toContain(BADGE);
	});
});

describe("how many items land on the change request", () => {
	test("levels 0 to 4: a comment with the reasons and a one-line review", () => {
		for (const level of [0, 1, 2, 3, 4]) {
			const p = plan({}, level);
			expect(p.comment).toBe("upsert");
			expect(p.review).toBe("Blocked. See the comment.");
		}
	});

	test("level 5: one review with the rule names and the button, no comment", () => {
		const p = plan({}, 5);
		expect(p.comment).toBe("delete");
		expect(p.review).toContain(
			"4 rules did not pass: Account age, Crypto address, AI review and Doesn't go to main.",
		);
		expect(p.review).toContain(BADGE);
		expect(p.review).toContain("How do I fix this?");
		expect(p.review).not.toContain(COMMENT_MARKER);
		expect(p.review).toMatchSnapshot();
	});

	test("level 5 caps the names at five", () => {
		const p = plan({ reasons: MANY }, 5);
		expect(p.review).toContain(
			"7 rules did not pass: Account age, Crypto address, AI review, Doesn't go to main, Max files changed and 2 more.",
		);
	});

	test("levels 6 and 7: one review with the count", () => {
		for (const level of [6, 7]) {
			const p = plan({}, level);
			expect(p.comment).toBe("delete");
			expect(p.review).toContain("4 rules did not pass.");
			expect(p.review).not.toContain("Account age");
		}
	});

	test("level 8: one review with the verdict and the button", () => {
		const p = plan({}, 8);
		expect(p.comment).toBe("delete");
		expect(sentences(p.review)).toEqual([
			"@octocat, Tripwire blocked this change request.",
			"How do I fix this?",
			"Fix what you can and push.",
			"Some problems will not clear with a new commit.",
			"If you think it should merge anyway, say so in a comment.",
			"A maintainer will decide.",
		]);
		expect(p.review).toContain(BADGE);
	});

	test("help off keeps the review to the verdict and the button", () => {
		const p = plan(
			{},
			8,
			DEFAULT_RESPONSE_CONFIG,
			true,
			policy(8, { showHelp: false }),
		);
		expect(p.review).toBe(
			`@octocat, Tripwire blocked this change request.\n\n${BADGE}`,
		);
	});

	test("comment off: the review never says to see the comment", () => {
		const off = config({ onBlock: "silent" });
		for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
			const p = plan({}, level, off);
			expect(p.comment).toBe("delete");
			expect(p.review).not.toContain("See the comment");
			expect(p.review).toContain("Tripwire blocked this change request.");
		}
		expect(plan({}, 0, off).review).toMatchSnapshot();
	});

	test("custom text or a template still posts a comment at high levels", () => {
		const text = config({ blockComment: { customText: "Not this time." } });
		expect(plan({}, 8, text).comment).toBe("upsert");
		expect(plan({}, 8, text).review).toBe(REVIEW_POINTER.block);
		const template = config({
			blockComment: { mode: "custom", template: "Held: {{ruleName}}" },
		});
		expect(plan({}, 6, template).comment).toBe("upsert");
	});

	test("no review (open-git, or no block action): the comment carries it all", () => {
		const p = plan({}, 6, DEFAULT_RESPONSE_CONFIG, false);
		expect(p.comment).toBe("upsert");
		expect(p.review).toBeNull();
		expect(p.commentBody).toContain("4 rules did not pass.");
	});

	test("a surface left open renders its own level", () => {
		const reviewOpen = policy(6, {
			surfaces: ["comment", "check", "run-page"],
		});
		const p = plan({}, 6, DEFAULT_RESPONSE_CONFIG, true, reviewOpen);
		expect(p.comment).toBe("delete");
		expect(p.review).toContain("**Account age:**");
	});

	test("human review: one comment, never a review", () => {
		const p = plan(
			{ verdict: "needs_review", reasons: [] },
			0,
			DEFAULT_RESPONSE_CONFIG,
			false,
		);
		expect(p.comment).toBe("upsert");
		expect(p.review).toBeNull();
		expect(p.commentBody).toMatchSnapshot();
	});

	test("human review when Tripwire could not finish", () => {
		const p = plan(
			{ verdict: "needs_review", reasons: [], degraded: true },
			0,
			DEFAULT_RESPONSE_CONFIG,
			false,
		);
		expect(p.commentBody?.split("\n")[0]).toBe(
			"@octocat, Tripwire could not finish checking this change request, so it needs human review. A maintainer will approve or block it.",
		);
		expect(checkSummary("needs_review", [], true)).toBe(
			"Waiting for human review. Tripwire could not finish checking.",
		);
	});

	test("human review and a block action at once: the review points at the comment", () => {
		const p = plan({ verdict: "needs_review", reasons: MAIN });
		expect(p.comment).toBe("upsert");
		expect(p.review).toBe("Needs human review. See the comment.");
		expect(p.commentBody).not.toContain("Account age");
		const quiet = plan(
			{ verdict: "needs_review", reasons: MAIN },
			0,
			config({ moderationQueued: "silent" }),
		);
		expect(quiet.comment).toBe("none");
		expect(quiet.review).toBe(
			`@octocat, this change request needs human review. A maintainer will approve or block it.\n\n${BADGE}`,
		);
	});

	test("passed: at most one comment, never a review", () => {
		expect(plan({ verdict: "pass", reasons: [] }).comment).toBe("none");
		expect(plan({ verdict: "pass", reasons: [] }).review).toBeNull();
		const loud = plan(
			{ verdict: "pass", reasons: [] },
			0,
			config({ onSuccess: "comment" }),
		);
		expect(loud.comment).toBe("upsert");
		expect(loud.review).toBeNull();
		expect(loud.commentBody).toMatchSnapshot();
	});
});

describe("transitions", () => {
	test("block to pass only updates a comment that is already there", () => {
		const p = plan({ verdict: "pass", reasons: [], previousVerdict: "block" });
		expect(p.comment).toBe("if-present");
		expect(p.review).toBeNull();
		expect(p.commentBody).toMatchSnapshot();
	});

	test("block to human review", () => {
		const p = plan({
			verdict: "needs_review",
			reasons: [],
			previousVerdict: "block",
		});
		expect(p.comment).toBe("upsert");
		expect(p.commentBody?.split("\n")[0]).toBe(
			"@octocat, Tripwire no longer blocks this change request, but it needs human review. A maintainer will approve or block it.",
		);
	});

	test("block, pass, block at every level", () => {
		for (const level of [0, 5, 8]) {
			const first = plan({}, level);
			const cleared = plan(
				{ verdict: "pass", reasons: [], previousVerdict: "block" },
				level,
			);
			const again = plan({ previousVerdict: "pass" }, level);
			expect(cleared.comment).toBe("if-present");
			if (level <= 4) {
				expect(first.comment).toBe("upsert");
				expect(again.comment).toBe("upsert");
				expect(again.commentBody?.split("\n")[0]).toBe(
					"@octocat, Tripwire now blocks this change request.",
				);
			} else {
				expect(first.comment).toBe("delete");
				expect(again.comment).toBe("delete");
				expect(again.review?.split("\n")[0]).toBe(
					"@octocat, Tripwire now blocks this change request.",
				);
			}
		}
	});

	test("re-run note rides under the reasons", () => {
		const body = renderVerdictComment(
			input({ rerun: true, reasons: [FILES] }),
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain(
			"Split it into smaller change requests.\n\nTripwire checked this again with the current rules.",
		);
	});
});

describe("no two items on one change request repeat a sentence", () => {
	const configs: [string, ResponseConfig][] = [
		["default", DEFAULT_RESPONSE_CONFIG],
		["comment off", config({ onBlock: "silent" })],
		["one line per rule", config({ blockComment: { mode: "one-liner-link" } })],
		["link off", config({ blockComment: { showDetailsButton: false } })],
	];
	for (const [name, cfg] of configs) {
		for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
			test(`${name}, level ${level}`, () => {
				for (const reasons of [[AGE], MAIN, MANY]) {
					const p = plan({ reasons }, level, cfg);
					expectNoRepeats(p, checkSummary("block", reasons, false, level));
				}
			});
		}
	}

	test("every verdict and transition", () => {
		const verdicts: [Verdict, Verdict | null][] = [
			["pass", null],
			["pass", "block"],
			["needs_review", null],
			["needs_review", "block"],
			["block", "pass"],
			["block", "needs_review"],
		];
		for (const [verdict, previousVerdict] of verdicts) {
			for (const level of [0, 5, 8]) {
				const p = plan(
					{
						verdict,
						previousVerdict,
						reasons: verdict === "pass" ? [] : MAIN,
					},
					level,
					config({ onSuccess: "comment" }),
				);
				expectNoRepeats(p, checkSummary(verdict, MAIN, false, level));
			}
		}
	});
});

describe("renderVerdictComment: config-aware modes", () => {
	const modeConfig = (
		mode: BlockCommentMode,
		extra: Omit<NonNullable<ResponseConfigInput["blockComment"]>, "mode"> = {},
	) => config({ blockComment: { mode, ...extra } });

	test("full mode is byte-identical to renderCommentBody, every verdict", () => {
		const full = modeConfig("full");
		for (const verdict of ["pass", "block", "needs_review"] as const) {
			const one = input({ verdict, reasons: verdict === "block" ? MAIN : [] });
			expect(renderVerdictComment(one, full)).toBe(renderCommentBody(one));
		}
	});

	test("non-block verdicts render full regardless of mode", () => {
		const one = input({ verdict: "pass", reasons: [] });
		expect(renderVerdictComment(one, modeConfig("one-liner-link"))).toBe(
			renderCommentBody(one),
		);
	});

	test("custom: template vars substitute, marker still appended", () => {
		const body = renderVerdictComment(
			input(),
			modeConfig("custom", { template: "held: {{ruleName}}\n\n{{runUrl}}" }),
		);
		expect(body).toBe(
			[
				"held: your account is too new for this repository.",
				"",
				BADGE,
				"",
				COMMENT_MARKER,
				"",
			].join("\n"),
		);
	});

	test("custom: {{ruleName}} keeps the inserted text's casing", () => {
		const raw = renderVerdictComment(
			input({ reasons: [{ text: "fork rate is 12", remedy: "revise" }] }),
			modeConfig("custom", { template: "held: {{ruleName}}" }),
		);
		expect(raw).toContain("held: fork rate is 12");
	});

	test("custom: {{ruleName}} at the names level is the display name, never a ref", () => {
		const body = renderVerdictComment(
			input({ reasons: [CUSTOM] }),
			modeConfig("custom", { template: "held: {{ruleName}}" }),
			policy(5),
		);
		expect(body).toContain("held: Doesn't go to main");
	});

	test("custom: {{runUrl}} renders the button, never a bare url", () => {
		const body = renderVerdictComment(
			input(),
			modeConfig("custom", { template: "see {{runUrl}} for the evidence." }),
		);
		expect(body).toContain(BADGE);
		expect(body).not.toContain("see https://tripwire.sh");
	});
});

describe("renderVerdictComment: per-outcome custom text and the button", () => {
	const withOverride = (verdict: Verdict, override: OverrideInput) =>
		config(
			verdict === "pass"
				? { onSuccess: "comment", passComment: override }
				: verdict === "block"
					? { blockComment: override }
					: { reviewComment: override },
		);

	test("custom text replaces the whole body", () => {
		const body = renderVerdictComment(
			input(),
			withOverride("block", { customText: "This did not pass the checks." }),
		);
		expect(body).toContain("This did not pass the checks.");
		expect(body).not.toContain("Your account is 2 days old.");
		expect(body).not.toContain("This clears in 5 days.");
		expect(body).not.toContain("crypto");
		expect(body).not.toContain("How do I fix this?");
		expect(body).not.toContain("Tripwire blocked this");
		expect(body).toContain(BADGE);
		expect(body.trim().endsWith(COMMENT_MARKER)).toBe(true);
	});

	test("custom text and the button off leave only the message", () => {
		const body = renderVerdictComment(
			input(),
			withOverride("block", {
				customText: "did not pass.",
				showDetailsButton: false,
			}),
		);
		expect(body.replace(MARKERS, "").trim()).toBe("did not pass.");
	});

	test("button off without custom text keeps the reasons", () => {
		const body = renderVerdictComment(
			input(),
			withOverride("block", { showDetailsButton: false }),
		);
		expect(body).toContain("Your account is 2 days old.");
		expect(body).not.toContain("<a href");
		expect(body).toContain("<details><summary>How do I fix this?</summary>");
	});

	test("block and review custom text are independent", () => {
		const both = config({
			blockComment: { customText: "did not pass checks." },
			reviewComment: { customText: "a maintainer will look shortly." },
		});
		const block = renderVerdictComment(input(), both);
		const review = renderVerdictComment(
			input({ verdict: "needs_review", reasons: [] }),
			both,
		);
		expect(block).toContain("did not pass checks.");
		expect(block).not.toContain("a maintainer will look shortly.");
		expect(review).toContain("a maintainer will look shortly.");
		expect(review).not.toContain("did not pass checks.");
	});
});

describe("responseConfig: defaults and surface gates", () => {
	test("defaults: check-only pass, full comment on block and review", () => {
		expect(DEFAULT_RESPONSE_CONFIG).toEqual({
			onSuccess: "ci-check",
			passComment: { customText: "", showDetailsButton: true },
			onBlock: "comment",
			blockComment: {
				customText: "",
				showDetailsButton: true,
				mode: "full",
				template: "",
			},
			moderationQueued: "comment",
			reviewComment: { customText: "", showDetailsButton: true },
			failClosedFallback: true,
			redaction: {
				inherit: true,
				level: 0,
				surfaces: ["run-page", "check", "comment", "review"],
				showHelp: true,
			},
		});
		expect(responseConfigSchema.parse({})).toEqual(DEFAULT_RESPONSE_CONFIG);
	});

	test("a legacy row upgrades with defaults, never undefined", () => {
		const parsed = responseConfigSchema.parse({
			onSuccess: "ci-check",
			onBlock: "comment",
			blockComment: { mode: "full", showRuleName: true, template: "" },
			moderationQueued: "comment",
		});
		expect(parsed.passComment).toEqual({
			customText: "",
			showDetailsButton: true,
		});
		expect(parsed.blockComment.customText).toBe("");
		expect(parsed.blockComment.showDetailsButton).toBe(true);
	});

	test("wantsComment follows the per-verdict setting", () => {
		expect(wantsComment(DEFAULT_RESPONSE_CONFIG, "pass")).toBe(false);
		expect(wantsComment(DEFAULT_RESPONSE_CONFIG, "block")).toBe(true);
		expect(wantsComment(DEFAULT_RESPONSE_CONFIG, "needs_review")).toBe(true);
		const quiet = config({ onBlock: "silent", moderationQueued: "silent" });
		expect(wantsComment(quiet, "block")).toBe(false);
		expect(wantsComment(quiet, "needs_review")).toBe(false);
	});

	test("the check never drops for block or human review", () => {
		const silent = config({
			onSuccess: "silent",
			onBlock: "silent",
			moderationQueued: "silent",
		});
		expect(wantsCheck(silent, "block")).toBe(true);
		expect(wantsCheck(silent, "needs_review")).toBe(true);
		expect(wantsCheck(silent, "pass")).toBe(false);
	});
});

describe("checkSummary", () => {
	test("per verdict", () => {
		expect(checkSummary("block", MAIN)).toBe(
			"Blocked by Account age, Crypto address, AI review and Doesn't go to main.",
		);
		expect(checkSummary("block", [])).toBe("Blocked.");
		expect(checkSummary("block", [AGE], false, 6)).toBe("Blocked by 1 rule.");
		expect(checkSummary("block", MANY)).toBe(
			"Blocked by Account age, Crypto address, AI review, Doesn't go to main, Max files changed and 2 more.",
		);
		expect(checkSummary("pass", [])).toBe("Passed.");
		expect(checkSummary("needs_review", [])).toBe("Waiting for human review.");
	});
});
