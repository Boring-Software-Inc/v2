import { describe, expect, test } from "bun:test";
import {
	type BlockLens,
	blockCommentAddsDetail,
	blockHidden,
	blocksFor,
	type CommentInput,
	type CommentReason,
	defaultBlocks,
	planSurfaces,
	RERUN_NOTE,
	renderBlockOutputs,
	renderBlocks,
	renderVerdictComment,
	variableHidden,
	variableText,
} from "./comment-render.ts";
import {
	REDACTION_ITEMS,
	REDACTION_MAX_LEVEL,
	redactionPolicySchema,
} from "./redaction.ts";
import {
	type ResponseBlock,
	responseBlocksSchema,
	responseConfigSchema,
} from "./response.ts";

const RUN_URL = "https://tripwire.sh/runs/0198abcd";
const BUTTON = `<a href="${RUN_URL}"><img src="https://tripwire.sh/badges/view-run.png" width="185" alt="View on Tripwire" /></a>`;

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

const GIF = {
	id: "abc123",
	url: "https://media.giphy.com/media/abc123/giphy.gif",
	width: 200,
	height: 120,
	title: "door closing",
};

function input(extra: Partial<CommentInput> = {}): CommentInput {
	return {
		verdict: "block",
		contributorLogin: "octocat",
		reasons: [AGE, CRYPTO],
		runUrl: RUN_URL,
		title: "Add sponsor wallet",
		targetBranch: "release/2.x",
		...extra,
	};
}

function lens(level: number, extra: Partial<BlockLens> = {}): BlockLens {
	return { level, showHelp: true, viewer: "outsider", ...extra };
}

function one(
	block: ResponseBlock,
	extra: Partial<CommentInput> = {},
	level = 0,
) {
	return renderBlocks([block], input(extra), lens(level));
}

const ALL_BLOCKS: ResponseBlock[] = [
	{ id: "a", type: "headline" },
	{ id: "b", type: "verdict-line" },
	{ id: "c", type: "instruction" },
	{
		id: "d",
		type: "text",
		parts: [
			{ kind: "var", name: "author" },
			{ kind: "text", text: ", fix these first: " },
			{ kind: "var", name: "failed-rules" },
		],
	},
	{ id: "e", type: "failed-rules", style: "full" },
	{ id: "f", type: "notes" },
	{ id: "g", type: "ai-notice" },
	{ id: "h", type: "rerun-notice" },
	{ id: "i", type: "run-link" },
	{ id: "j", type: "help" },
	{ id: "k", type: "gif", gif: GIF },
];

describe("each block type", () => {
	test("headline speaks the verdict", () => {
		expect(one({ id: "a", type: "headline" })).toBe(
			"@octocat, Tripwire blocked this change request.",
		);
		expect(
			one(
				{ id: "a", type: "headline" },
				{ verdict: "pass", notes: ["Docs only."] },
			),
		).toBe("Tripwire passed this change request. Docs only.");
		expect(
			one(
				{ id: "a", type: "headline" },
				{
					verdict: "changes_required",
					fixes: [{ message: "Change the target to main.", reasons: [] }],
				},
			),
		).toBe("Changes needed. Change the target to main.");
	});

	test("verdict line is the check summary", () => {
		expect(one({ id: "b", type: "verdict-line" })).toBe(
			"Blocked by Account age and Crypto address.",
		);
		expect(one({ id: "b", type: "verdict-line" }, {}, 6)).toBe(
			"Blocked by 2 rules.",
		);
	});

	test("instruction carries fixes and pending review on other verdicts", () => {
		expect(
			one(
				{ id: "c", type: "instruction" },
				{ fixes: [{ message: "Change the target to main.", reasons: [] }] },
			),
		).toBe("Changes needed. Change the target to main.");
		expect(one({ id: "c", type: "instruction" }, { reviewPending: true })).toBe(
			"Human review is pending.",
		);
		expect(one({ id: "c", type: "instruction" })).toBe("");
	});

	test("failed rules list full or one line each", () => {
		expect(one({ id: "e", type: "failed-rules", style: "full" })).toBe(
			"- **Account age:** Your account is 2 days old. This clears in 5 days.\n- **Crypto address:** It adds 2 crypto wallet addresses to DONATE.md. Remove the addresses.",
		);
		expect(
			one({ id: "e", type: "failed-rules", style: "one-liner" }),
		).toContain("- **Account age:**");
	});

	test("notes show on every verdict but pass, where the headline carries them", () => {
		expect(one({ id: "f", type: "notes" }, { notes: ["Docs only."] })).toBe(
			"Docs only.",
		);
		expect(
			one(
				{ id: "f", type: "notes" },
				{ verdict: "pass", notes: ["Docs only."] },
			),
		).toBe("");
	});

	test("notices show only when the run says so", () => {
		expect(one({ id: "g", type: "ai-notice" })).toBe("");
		expect(one({ id: "g", type: "ai-notice" }, { aiReviewNotRun: true })).toBe(
			"AI review did not run.",
		);
		expect(one({ id: "h", type: "rerun-notice" })).toBe("");
		expect(one({ id: "h", type: "rerun-notice" }, { rerun: true })).toBe(
			RERUN_NOTE,
		);
	});

	test("run link, help and gif", () => {
		expect(one({ id: "i", type: "run-link" })).toBe(BUTTON);
		expect(one({ id: "j", type: "help" })).toStartWith(
			"<details><summary>How do I fix this?</summary>",
		);
		expect(one({ id: "k", type: "gif", gif: GIF })).toBe(
			`![door closing](${GIF.url})`,
		);
		expect(one({ id: "k", type: "gif", gif: null })).toBe("");
	});

	test("text joins its parts and trims", () => {
		expect(
			one({
				id: "d",
				type: "text",
				parts: [
					{ kind: "text", text: "  " },
					{ kind: "var", name: "author" },
					{ kind: "text", text: " opened " },
					{ kind: "var", name: "title" },
					{ kind: "text", text: " against " },
					{ kind: "var", name: "target-branch" },
					{ kind: "text", text: ". " },
				],
			}),
		).toBe("@octocat opened Add sponsor wallet against release/2.x.");
	});
});

describe("variables", () => {
	test("contributor text is escaped and cannot mention anyone", () => {
		const text = variableText(
			"title",
			input({ title: "Ping @admin *now* <script>" }),
			0,
		);
		expect(text).toBe("Ping @​admin \\*now\\* \\<script\\>");
	});

	test("failed rules fall back to a count once rule names hide", () => {
		expect(variableText("failed-rules", input(), 0)).toBe(
			"Account age and Crypto address",
		);
		expect(variableText("failed-rules", input(), 5)).toBe(
			"Account age and Crypto address",
		);
		expect(variableText("failed-rules", input(), 6)).toBe("2 rules");
		expect(variableText("failed-rules", input({ reasons: [AGE] }), 6)).toBe(
			"1 rule",
		);
		expect(variableText("failed-rules", input({ reasons: [] }), 0)).toBe("");
	});

	test("failed rules stop counting once the count hides", () => {
		expect(variableText("failed-rules", input(), 7)).toBe("2 rules");
		expect(variableText("failed-rules", input(), REDACTION_MAX_LEVEL)).toBe(
			"some rules",
		);
	});

	test("only rule variables hide, and members see them", () => {
		for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
			expect(variableHidden("author", lens(level))).toBe(false);
			expect(variableHidden("title", lens(level))).toBe(false);
			expect(variableHidden("failed-rules", lens(level))).toBe(level >= 6);
			expect(
				variableHidden("failed-rules", lens(level, { viewer: "member" })),
			).toBe(false);
		}
	});
});

describe("redaction lens", () => {
	test("every level: failed rules drop only once the count hides", () => {
		for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
			const outputs = renderBlockOutputs(ALL_BLOCKS, input(), lens(level));
			const hidden = outputs
				.filter((output) => output.body === null)
				.map((output) => output.block.type);
			expect(hidden).toEqual(level >= 8 ? ["failed-rules"] : []);
		}
	});

	test("rule names hidden degrades the list to a count", () => {
		expect(one({ id: "e", type: "failed-rules", style: "full" }, {}, 6)).toBe(
			"2 rules did not pass.",
		);
		expect(one({ id: "e", type: "failed-rules", style: "full" }, {}, 5)).toBe(
			"2 rules did not pass: Account age and Crypto address.",
		);
	});

	test("help hides when the policy turns it off", () => {
		const help: ResponseBlock = { id: "j", type: "help" };
		expect(blockHidden(help, lens(0, { showHelp: false }))).toBe(true);
		expect(
			blockHidden(help, lens(0, { showHelp: false, viewer: "member" })),
		).toBe(false);
	});

	test("a member sees the open comment at any level", () => {
		const open = renderBlocks(ALL_BLOCKS, input(), lens(0));
		for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
			expect(
				renderBlocks(ALL_BLOCKS, input(), lens(level, { viewer: "member" })),
			).toBe(open);
		}
	});

	test("the reason list caps at five only when a run link follows", () => {
		const many = input({
			reasons: [AGE, CRYPTO, AGE, CRYPTO, AGE, CRYPTO, AGE],
		});
		const list: ResponseBlock = {
			id: "e",
			type: "failed-rules",
			style: "full",
		};
		expect(renderBlocks([list], many, lens(0))).not.toContain("And 2 more.");
		expect(
			renderBlocks([list, { id: "i", type: "run-link" }], many, lens(0)),
		).toContain("And 2 more.");
	});
});

describe("no rule name leaks once rule names hide", () => {
	const firstHidden = REDACTION_ITEMS.indexOf("rule-names") + 1;
	const verdicts = [
		"block",
		"changes_required",
		"needs_review",
		"close",
	] as const;
	const everyVariable: ResponseBlock = {
		id: "v",
		type: "text",
		parts: [
			{ kind: "var", name: "author" },
			{ kind: "var", name: "failed-rules" },
			{ kind: "var", name: "rule-name" },
			{ kind: "var", name: "title" },
			{ kind: "var", name: "target-branch" },
			{ kind: "var", name: "run-link" },
		],
	};
	const oneLiner: ResponseBlock = {
		id: "o",
		type: "failed-rules",
		style: "one-liner",
	};

	test("any block, any verdict, every level from rule names up", () => {
		for (const verdict of verdicts) {
			for (let level = firstHidden; level <= REDACTION_MAX_LEVEL; level++) {
				const body = renderBlocks(
					[...ALL_BLOCKS, everyVariable, oneLiner],
					input({
						verdict,
						fixes: [{ message: null, reasons: [CRYPTO] }],
						reviewPending: true,
					}),
					lens(level),
				);
				for (const name of ["Account age", "Crypto address", "account-age"]) {
					expect(body).not.toContain(name);
				}
				if (level === REDACTION_MAX_LEVEL) {
					expect(body).not.toMatch(/\d rules?\b/);
				}
			}
		}
	});
});

describe("empty states", () => {
	test("no blocks render nothing", () => {
		expect(renderBlocks([], input(), lens(0))).toBe("");
	});

	test("blocks with nothing to say leave no blank paragraphs", () => {
		expect(
			renderBlocks(
				[
					{ id: "g", type: "ai-notice" },
					{ id: "a", type: "headline" },
					{ id: "h", type: "rerun-notice" },
					{ id: "k", type: "gif", gif: null },
					{ id: "d", type: "text", parts: [] },
				],
				input(),
				lens(0),
			),
		).toBe("@octocat, Tripwire blocked this change request.");
	});

	test("a run without reasons renders an empty list", () => {
		expect(
			one({ id: "e", type: "failed-rules", style: "full" }, { reasons: [] }),
		).toBe("");
	});
});

describe("stored blocks", () => {
	test("win over the old settings for their outcome", () => {
		const config = responseConfigSchema.parse({
			blockComment: { customText: "old text" },
			blocks: {
				block: [
					{
						id: "x",
						type: "text",
						parts: [{ kind: "text", text: "New text." }],
					},
				],
			},
		});
		expect(renderVerdictComment(input(), config)).toStartWith("New text.");
		expect(
			renderVerdictComment(input({ verdict: "needs_review" }), config),
		).toContain("needs human review");
	});

	test("note only stores its own list, a plain pass keeps the default", () => {
		const config = responseConfigSchema.parse({
			onSuccess: "comment",
			blocks: { note: [{ id: "x", type: "headline" }] },
		});
		expect(
			blocksFor(config, "pass", { notes: true }).map((block) => block.id),
		).toEqual(["x"]);
		expect(blocksFor(config, "pass").map((block) => block.id)).toContain(
			"headline",
		);
	});

	test("saving the defaults unchanged renders the same comment", () => {
		const legacy = responseConfigSchema.parse({});
		for (const verdict of [
			"block",
			"changes_required",
			"needs_review",
			"close",
		] as const) {
			const saved = responseConfigSchema.parse({
				blocks: { [verdict]: defaultBlocks(legacy, verdict) },
			});
			for (let level = 0; level <= REDACTION_MAX_LEVEL; level++) {
				const policy = redactionPolicySchema.parse({ level });
				expect(renderVerdictComment(input({ verdict }), saved, policy)).toBe(
					renderVerdictComment(input({ verdict }), legacy, policy),
				);
			}
		}
	});

	test("a stored block list decides whether the block comment adds detail", () => {
		const policy = redactionPolicySchema.parse({ level: 6 });
		const bare = responseConfigSchema.parse({
			blocks: {
				block: [
					{ id: "a", type: "headline" },
					{ id: "e", type: "failed-rules" },
					{ id: "i", type: "run-link" },
				],
			},
		});
		expect(blockCommentAddsDetail(bare, policy)).toBe(false);
		expect(
			planSurfaces(input(), bare, policy, { reviewPosted: true }).comment,
		).toBe("delete");
		const withText = responseConfigSchema.parse({
			blocks: {
				block: [
					{ id: "d", type: "text", parts: [{ kind: "text", text: "Hi." }] },
				],
			},
		});
		expect(blockCommentAddsDetail(withText, policy)).toBe(true);
	});
});

describe("the blocks schema", () => {
	test("a gif block only fits the close outcome", () => {
		const gif = [{ id: "k", type: "gif", gif: GIF }];
		expect(responseBlocksSchema.safeParse({ close: gif }).success).toBe(true);
		expect(responseBlocksSchema.safeParse({ block: gif }).success).toBe(false);
	});

	test("ids are unique and text stays under the limit", () => {
		expect(
			responseBlocksSchema.safeParse({
				block: [
					{ id: "a", type: "headline" },
					{ id: "a", type: "help" },
				],
			}).success,
		).toBe(false);
		expect(
			responseBlocksSchema.safeParse({
				block: [
					{
						id: "a",
						type: "text",
						parts: [
							{ kind: "text", text: "x".repeat(3000) },
							{ kind: "text", text: "x".repeat(1001) },
						],
					},
				],
			}).success,
		).toBe(false);
	});

	test("an unknown variable is refused", () => {
		expect(
			responseBlocksSchema.safeParse({
				block: [
					{ id: "a", type: "text", parts: [{ kind: "var", name: "email" }] },
				],
			}).success,
		).toBe(false);
	});

	test("the template becomes structured parts", () => {
		const config = responseConfigSchema.parse({
			blockComment: {
				mode: "custom",
				template: "blocked: {{ruleName}}\n\n{{runUrl}}",
			},
		});
		expect(defaultBlocks(config, "block")).toEqual([
			{
				id: "text",
				type: "text",
				parts: [
					{ kind: "text", text: "blocked: " },
					{ kind: "var", name: "rule-name" },
					{ kind: "text", text: "\n\n" },
					{ kind: "var", name: "run-link" },
				],
			},
		]);
	});
});
