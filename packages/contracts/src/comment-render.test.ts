import { describe, expect, test } from "bun:test";
import {
	COMMENT_MARKER,
	type CommentInput,
	checkSummary,
	renderCommentBody,
	renderVerdictComment,
} from "./comment-render.ts";
import {
	DEFAULT_RESPONSE_CONFIG,
	responseConfigSchema,
	wantsCheck,
	wantsComment,
} from "./response.ts";

/** Every hidden `<!-- tripwire:… -->` marker, so tests can check visible copy. */
const MARKERS = /<!-- tripwire:[^>]*-->/g;

/**
 * §11 snapshot layer: rendered PR comments vs golden files — the presenter
 * physically cannot write an essay. MOVED here from forge-github's
 * actions.test.ts with the render layer (customize build step); the golden
 * files moved VERBATIM. Full mode is the locked baseline: if these snapshots
 * ever need regenerating, that is a regression, not a new baseline.
 */

const BLOCKED_REASONS = [
	{
		text: "your account is 2 days old",
		remedy: "wait" as const,
		waitHint: "it clears in 5 days",
	},
	{
		text: "it adds 2 crypto addresses in DONATE.md",
		remedy: "revise" as const,
	},
];

describe("renderCommentBody — snapshot golden files", () => {
	test("blocked (mixed remedies, wait-hint inline)", () => {
		expect(
			renderCommentBody({
				verdict: "block",
				contributorLogin: "octocat",
				reasons: BLOCKED_REASONS,
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("blocked (3+ reasons collapse to plus-N)", () => {
		expect(
			renderCommentBody({
				verdict: "block",
				contributorLogin: "octocat",
				reasons: [
					{ text: "it adds 2 crypto addresses in DONATE.md", remedy: "revise" },
					{ text: "this change touches 40 files", remedy: "revise" },
					{ text: "the title isn't in latin script", remedy: "revise" },
				],
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("passed", () => {
		expect(
			renderCommentBody({
				verdict: "pass",
				contributorLogin: "octocat",
				reasons: [],
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("sent to review", () => {
		expect(
			renderCommentBody({
				verdict: "needs_review",
				contributorLogin: "octocat",
				reasons: [],
				runUrl: "https://tripwire.sh/runs/0198abcd",
				badgeUrl: "https://tripwire.sh/badges/view-run.png",
			}),
		).toMatchSnapshot();
	});

	test("re-run: the quiet re-evaluation note rides under the headline", () => {
		const body = renderCommentBody({
			verdict: "pass",
			contributorLogin: "octocat",
			reasons: [],
			runUrl: "https://tripwire.sh/runs/0198abcd",
			badgeUrl: "https://tripwire.sh/badges/view-run.png",
			rerun: true,
		});
		// Same-verdict re-run edits the comment in place — this line is the only
		// visible evidence a maintainer deliberately re-evaluated.
		expect(body).toContain("re-evaluated under the repo's current rules.");
		expect(body).toMatchSnapshot();
	});

	test("the comment speaks reasons, not counts; button visible; @-mentions", () => {
		const body = renderCommentBody({
			verdict: "block",
			contributorLogin: "octocat",
			reasons: BLOCKED_REASONS,
			runUrl: "https://tripwire.sh/runs/x",
			badgeUrl: "https://tripwire.sh/badges/view-run.png",
		});
		const lines = body.trim().split("\n").filter(Boolean);
		// Verdict line present, @-mentions the contributor, no "tripwire:" prefix
		// in the visible copy (the hidden marker is the only legit occurrence).
		expect(lines[0]).toBe("**blocked** — @octocat, this can't merge yet.");
		expect(body.replace(MARKERS, "")).not.toContain("tripwire:");
		// Never counts rules.
		expect(body).not.toMatch(/\d+ of \d+ rules?/);
		// The wait-hint rides inline after its reason.
		expect(body).toContain("your account is 2 days old — it clears in 5 days");
		// The button is VISIBLE — not wrapped in any <details>.
		const buttonLine = lines.find((l) => l.includes("badges/view-run.png"));
		expect(buttonLine).toContain('href="https://tripwire.sh/runs/x"');
		expect(buttonLine).not.toContain("<details>");
		expect(body).not.toContain("for maintainers");
		// The how-to-fix + explainer collapse into details; one marker, last line.
		expect(body).toContain("<details><summary>how do i fix this?</summary>");
		expect(body).toContain("<details><summary>what is tripwire?</summary>");
		expect((body.match(new RegExp(COMMENT_MARKER)) ?? []).length).toBe(1);
		expect(lines.at(-1)).toBe(COMMENT_MARKER);
	});
});

const BLOCK_INPUT: CommentInput = {
	verdict: "block",
	contributorLogin: "octocat",
	reasons: [
		{
			text: "your account is 2 days old",
			remedy: "wait",
			waitHint: "it clears in 5 days",
			ruleId: "account-age",
		},
		{
			text: "it adds 2 crypto addresses in DONATE.md",
			remedy: "revise",
			ruleId: "crypto-address",
		},
		{
			text: "this change touches 40 files",
			remedy: "revise",
			ruleId: "max-files-changed",
		},
	],
	runUrl: "https://tripwire.sh/runs/0198abcd",
	badgeUrl: "https://tripwire.sh/badges/view-run.png",
};

describe("renderVerdictComment — config-aware modes", () => {
	// renderVerdictComment resolves the per-outcome override from the full config,
	// so mode-only cases wrap their blockComment in a default ResponseConfig.
	const modeConfig = (mode: string, extra: Record<string, unknown> = {}) =>
		responseConfigSchema.parse({ blockComment: { mode, ...extra } });

	test("full mode is byte-identical to renderCommentBody, every verdict", () => {
		const full = modeConfig("full");
		for (const verdict of ["pass", "block", "needs_review"] as const) {
			const input: CommentInput = {
				...BLOCK_INPUT,
				verdict,
				reasons: verdict === "block" ? BLOCK_INPUT.reasons : [],
			};
			expect(renderVerdictComment(input, full)).toBe(renderCommentBody(input));
		}
	});

	test("non-block verdicts render full regardless of mode", () => {
		const input: CommentInput = {
			...BLOCK_INPUT,
			verdict: "pass",
			reasons: [],
		};
		expect(renderVerdictComment(input, modeConfig("link-only"))).toBe(
			renderCommentBody(input),
		);
	});

	test("one-liner-link: one contributor label per failed rule, never plus-N", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			modeConfig("one-liner-link"),
		);
		// Every failed rule speaks — catalog contributor labels, name-prefixed.
		expect(body).toContain(
			"account age: your account is newer than this repo allows.",
		);
		expect(body).toContain(
			"crypto address: this change request contains a cryptocurrency address.",
		);
		expect(body).toContain(
			"max files changed: this change request touches too many files.",
		);
		expect(body).not.toContain("other things");
		// Brief mode: no collapsibles, but headline + button + marker stay.
		expect(body).not.toContain("<details>");
		expect(body).toContain("**blocked**");
		expect(body).toContain('href="https://tripwire.sh/runs/0198abcd"');
		expect(body).toContain(COMMENT_MARKER);
		expect(body).toMatchSnapshot();
	});

	test("one-liner-link without rule names drops the prefix", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			modeConfig("one-liner-link", { showRuleName: false }),
		);
		expect(body).toContain("your account is newer than this repo allows.");
		expect(body).not.toContain("account age:");
	});

	test("link-only: verdict line and button, no reasons", () => {
		const body = renderVerdictComment(BLOCK_INPUT, modeConfig("link-only"));
		expect(body).toContain("**blocked**");
		expect(body).not.toContain("account");
		expect(body).toContain('href="https://tripwire.sh/runs/0198abcd"');
		expect(body).toContain(COMMENT_MARKER);
		expect(body).toMatchSnapshot();
	});

	test("custom: template vars substitute, marker still appended", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			modeConfig("custom", {
				template: "held: {{ruleName}}\n\n{{runUrl}}",
			}),
		);
		expect(body).toBe(
			[
				"held: your account is newer than this repo allows.",
				"",
				'<a href="https://tripwire.sh/runs/0198abcd"><img src="https://tripwire.sh/badges/view-run.png" width="185" alt="View on Tripwire" /></a>',
				"",
				COMMENT_MARKER,
				"",
			].join("\n"),
		);
	});

	test("custom: {{runUrl}} renders the run BUTTON, never a bare url", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			modeConfig("custom", { template: "see {{runUrl}} for the evidence." }),
		);
		expect(body).toContain('href="https://tripwire.sh/runs/0198abcd"');
		expect(body).toContain('alt="View on Tripwire"');
		expect(body).not.toContain("see https://tripwire.sh");
	});
});

describe("renderVerdictComment — per-outcome custom text + details button", () => {
	const withOverride = (
		verdict: "pass" | "block" | "needs_review",
		override: Record<string, unknown>,
	) =>
		responseConfigSchema.parse(
			verdict === "pass"
				? { onSuccess: "comment", passComment: override }
				: verdict === "block"
					? { blockComment: override }
					: { reviewComment: override },
		);

	test("custom text REPLACES the whole body — no reason, remedy, or explainer survives", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			withOverride("block", {
				customText: "this change didn't pass the repo's checks.",
			}),
		);
		expect(body).toContain("this change didn't pass the repo's checks.");
		// The load-bearing assertion (§customize): a naive summary-only swap would
		// strand the wait-hint / how-to-fix remedy and leak the very rule the
		// maintainer set out to hide. NOTHING of the auto copy remains.
		expect(body).not.toContain("your account is 2 days old");
		expect(body).not.toContain("it clears in 5 days");
		expect(body).not.toContain("crypto");
		expect(body).not.toContain("how do i fix this?");
		expect(body).not.toContain("what is tripwire?");
		expect(body).not.toContain("**blocked**");
		// The run button still rides by default; the marker anchors the upsert (§7).
		expect(body).toContain('href="https://tripwire.sh/runs/0198abcd"');
		expect(body.trim().endsWith(COMMENT_MARKER)).toBe(true);
	});

	test("custom text + button off = the message and nothing else (full opacity)", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			withOverride("block", {
				customText: "did not pass.",
				showDetailsButton: false,
			}),
		);
		expect(body).not.toContain("badges/view-run.png");
		expect(body).not.toContain("your account");
		expect(body.replace(MARKERS, "").trim()).toBe("did not pass.");
	});

	test("button off without custom text keeps the reasons, drops only the run link", () => {
		const body = renderVerdictComment(
			BLOCK_INPUT,
			withOverride("block", { showDetailsButton: false }),
		);
		// The contributor still sees why; they just don't get the run-page link.
		expect(body).toContain("your account is 2 days old");
		expect(body).not.toContain("badges/view-run.png");
		expect(body).toContain("<details><summary>how do i fix this?</summary>");
	});

	test("block and review custom text are independent messages", () => {
		const config = responseConfigSchema.parse({
			blockComment: { customText: "did not pass checks." },
			reviewComment: { customText: "a maintainer will look shortly." },
		});
		const block = renderVerdictComment(
			{ ...BLOCK_INPUT, verdict: "block" },
			config,
		);
		const review = renderVerdictComment(
			{ ...BLOCK_INPUT, verdict: "needs_review", reasons: [] },
			config,
		);
		expect(block).toContain("did not pass checks.");
		expect(block).not.toContain("a maintainer will look shortly.");
		expect(review).toContain("a maintainer will look shortly.");
		expect(review).not.toContain("did not pass checks.");
	});

	test("pass custom text replaces the passed comment", () => {
		const body = renderVerdictComment(
			{ ...BLOCK_INPUT, verdict: "pass", reasons: [] },
			withOverride("pass", { customText: "all good — merge away." }),
		);
		expect(body).toContain("all good — merge away.");
		expect(body).not.toContain("nothing tripped");
	});
});

describe("responseConfig — defaults and surface gates", () => {
	test("defaults: check-only pass, full comment on block and review", () => {
		expect(DEFAULT_RESPONSE_CONFIG).toEqual({
			onSuccess: "ci-check",
			passComment: { customText: "", showDetailsButton: true },
			onBlock: "comment",
			blockComment: {
				customText: "",
				showDetailsButton: true,
				mode: "full",
				showRuleName: true,
				template: "",
			},
			moderationQueued: "comment",
			reviewComment: { customText: "", showDetailsButton: true },
		});
		expect(responseConfigSchema.parse({})).toEqual(DEFAULT_RESPONSE_CONFIG);
	});

	test("a legacy row (pre-custom-text) upgrades — new fields default in, never undefined", () => {
		// A stored response_configs row from before the per-outcome override
		// existed. Both getResponseConfig and the /customize unflatten re-parse
		// through this schema; a missing field must resolve to its default, not
		// leak `undefined` into a downstream `.trim()`.
		const legacy = {
			onSuccess: "ci-check",
			onBlock: "comment",
			blockComment: { mode: "full", showRuleName: true, template: "" },
			moderationQueued: "comment",
		};
		const parsed = responseConfigSchema.parse(legacy);
		expect(parsed.passComment).toEqual({
			customText: "",
			showDetailsButton: true,
		});
		expect(parsed.reviewComment).toEqual({
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
		const loud = responseConfigSchema.parse({ onSuccess: "comment" });
		expect(wantsComment(loud, "pass")).toBe(true);
		const quiet = responseConfigSchema.parse({
			onBlock: "silent",
			moderationQueued: "silent",
		});
		expect(wantsComment(quiet, "block")).toBe(false);
		expect(wantsComment(quiet, "needs_review")).toBe(false);
	});

	test("the check never drops for block or sent-to-review", () => {
		const silent = responseConfigSchema.parse({
			onSuccess: "silent",
			onBlock: "silent",
			moderationQueued: "silent",
		});
		expect(wantsCheck(silent, "block")).toBe(true);
		expect(wantsCheck(silent, "needs_review")).toBe(true);
		expect(wantsCheck(silent, "pass")).toBe(false);
		expect(wantsCheck(DEFAULT_RESPONSE_CONFIG, "pass")).toBe(true);
	});
});

describe("checkSummary — the check line the preview mirrors", () => {
	test("per verdict, degraded review named", () => {
		expect(checkSummary("block", BLOCK_INPUT.reasons)).toBe(
			"blocked — your account is 2 days old",
		);
		expect(checkSummary("pass", [])).toBe("passed — nothing tripped");
		expect(checkSummary("needs_review", [])).toBe(
			"sent to review — a maintainer needs to look at this",
		);
		expect(checkSummary("needs_review", [], true)).toBe(
			"sent to review — couldn't finish checking this change",
		);
	});
});
