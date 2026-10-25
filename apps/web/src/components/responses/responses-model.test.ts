import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RESPONSE_CONFIG,
	redactionPolicySchema,
	responseConfigSchema,
} from "@tripwire/contracts";
import {
	decodeGif,
	encodeGif,
	flattenConfig,
	OUTCOMES,
	outcomeBlocks,
	outcomeMeta,
	previewCheck,
	previewPlan,
	unflattenConfig,
} from "#/components/responses/responses-model";

const policy = (level: number) => redactionPolicySchema.parse({ level });

const GIF = {
	id: "l0MYt5jPR6QX5pnqM",
	url: "https://media2.giphy.com/media/l0MYt5jPR6QX5pnqM/200.gif",
	width: 356,
	height: 200,
	title: "Bye",
};

describe("the Responses preview shows what lands on the change request", () => {
	test("levels 0 to 4: the review points at the comment", () => {
		const plan = previewPlan(
			DEFAULT_RESPONSE_CONFIG,
			outcomeMeta("block"),
			policy(0),
		);
		expect(plan.review).toBe("Blocked. See the comment.");
		expect(plan.comment).toBe("upsert");
		expect(plan.commentBody).toContain("**Account age:**");
		expect(plan.commentBody).toContain('alt="View on Tripwire"');
	});

	test("level 6: one review, no comment", () => {
		const plan = previewPlan(
			DEFAULT_RESPONSE_CONFIG,
			outcomeMeta("block"),
			policy(6),
		);
		expect(plan.comment).toBe("delete");
		expect(plan.review).toContain("2 rules did not pass.");
	});

	test("only Block previews a review", () => {
		for (const outcome of OUTCOMES.filter((o) => o.value !== "block")) {
			expect(
				previewPlan(DEFAULT_RESPONSE_CONFIG, outcome, policy(0)).review,
			).toBeNull();
		}
	});

	test("Ask author to fix: the instruction in the comment and on a red check", () => {
		const outcome = outcomeMeta("changes_required");
		const plan = previewPlan(DEFAULT_RESPONSE_CONFIG, outcome, policy(0));
		expect(plan.commentBody).toContain(
			"Changes needed. Change the target to main.",
		);
		const check = previewCheck(DEFAULT_RESPONSE_CONFIG, outcome, policy(0));
		expect(check.verdict).toBe("changes_required");
		expect(check.summary).toBe("Changes needed. Change the target to main.");
	});

	test("Note only: the fact rides on a passing check", () => {
		const outcome = outcomeMeta("note");
		const plan = previewPlan(DEFAULT_RESPONSE_CONFIG, outcome, policy(0));
		expect(plan.commentBody).toContain(
			"Tripwire passed this change request. No description provided.",
		);
		expect(previewCheck(DEFAULT_RESPONSE_CONFIG, outcome, policy(0))).toEqual({
			posted: true,
			verdict: "pass",
			summary: "Passed.",
		});
		const quiet = responseConfigSchema.parse({ onNote: "silent" });
		expect(previewPlan(quiet, outcome, policy(0)).comment).toBe("none");
	});

	test("Close: the reason, the gif, a red check", () => {
		const outcome = outcomeMeta("close");
		const config = responseConfigSchema.parse({ closeComment: { gif: GIF } });
		const plan = previewPlan(config, outcome, policy(0));
		expect(plan.commentBody?.startsWith("Closed.")).toBe(true);
		expect(plan.commentBody).toContain("Your account is 2 days old.");
		expect(plan.commentBody).toContain(`![Bye](${GIF.url})`);
		const check = previewCheck(config, outcome, policy(0));
		expect(check.summary).toBe("Closed by Account age.");
	});

	test("Close keeps the gif at the highest redaction level", () => {
		const config = responseConfigSchema.parse({ closeComment: { gif: GIF } });
		const plan = previewPlan(config, outcomeMeta("close"), policy(8));
		expect(plan.commentBody).toContain(GIF.url);
		expect(plan.commentBody).not.toContain("2 days old");
	});

	test("an outcome without stored blocks starts from today's comment", () => {
		expect(
			outcomeBlocks(DEFAULT_RESPONSE_CONFIG, outcomeMeta("block")).map(
				(block) => block.type,
			),
		).toEqual([
			"headline",
			"ai-notice",
			"failed-rules",
			"instruction",
			"notes",
			"rerun-notice",
			"run-link",
			"help",
		]);
	});
});

describe("the save queue round trips every outcome setting", () => {
	test("flatten then unflatten is lossless", () => {
		const config = responseConfigSchema.parse({
			onClose: "silent",
			closeComment: {
				customText: "Closing.",
				showDetailsButton: false,
				gif: GIF,
			},
			onChangesRequired: "silent",
			changesRequiredComment: { customText: "Fix it." },
			onNote: "silent",
			blocks: {
				close: [
					{ id: "a", type: "headline" },
					{ id: "b", type: "gif", gif: GIF },
				],
				note: [],
			},
		});
		expect(unflattenConfig(flattenConfig(config))).toEqual(config);
		expect(unflattenConfig(flattenConfig(DEFAULT_RESPONSE_CONFIG))).toEqual(
			DEFAULT_RESPONSE_CONFIG,
		);
	});

	test("the gif encodes to a string the queue can compare", () => {
		expect(encodeGif(null)).toBe("");
		expect(decodeGif(encodeGif(GIF))).toEqual(GIF);
		expect(decodeGif("")).toBeNull();
		expect(decodeGif("{not json")).toBeNull();
		expect(
			decodeGif(JSON.stringify({ ...GIF, url: "https://evil.example/a.gif" })),
		).toBeNull();
	});

	test("segments in order", () => {
		expect(OUTCOMES.map((o) => o.label)).toEqual([
			"Block",
			"Ask author to fix",
			"Human review",
			"Note only",
			"Close",
		]);
	});
});
