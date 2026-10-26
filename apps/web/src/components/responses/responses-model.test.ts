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
	responsePreview,
	unflattenConfig,
} from "#/components/responses/responses-model";
import { sampleRunFor } from "#/components/responses/sample-run";

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

describe("every surface renders from the unsaved builder state", () => {
	const edited = (blocks: unknown) =>
		unflattenConfig({
			...flattenConfig(DEFAULT_RESPONSE_CONFIG),
			"blocks.block": JSON.stringify(blocks),
		});

	test("at level 0 the comment holds every block and the review points at it", () => {
		const config = edited([
			{ id: "a", type: "headline" },
			{ id: "b", type: "ai-notice" },
			{ id: "c", type: "rerun-notice" },
			{ id: "d", type: "run-link" },
		]);
		const preview = responsePreview(
			config,
			outcomeMeta("block"),
			policy(0),
			"outsider",
		);
		expect(preview.blocks.map((block) => block.id)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(preview.plan.comment).toBe("upsert");
		expect(preview.plan.review).toBe("Blocked. See the comment.");
		for (const output of preview.outputs) {
			if (output.body) {
				expect(preview.plan.commentBody).toContain(output.body);
			}
		}
	});

	test("level zero leaves sample-dependent blocks empty without redacting them", () => {
		const preview = responsePreview(
			DEFAULT_RESPONSE_CONFIG,
			outcomeMeta("block"),
			policy(0),
			"outsider",
		);
		expect(preview.outputs.some((output) => output.body === null)).toBe(false);
		for (const type of ["ai-notice", "instruction", "notes", "rerun-notice"]) {
			expect(
				preview.outputs.find((output) => output.block.type === type)?.body,
			).toBe("");
		}
		expect(
			preview.outputs.find((output) => output.block.type === "failed-rules")
				?.body,
		).toContain("Account age");
	});

	test("draft redaction changes every applicable outsider surface while members retain detail", () => {
		const config = edited([
			{ id: "reasons", type: "failed-rules", style: "full" },
		]);
		const outcome = outcomeMeta("block");
		const hidden = responsePreview(config, outcome, policy(8), "outsider");
		expect(hidden.outputs[0]?.body).toBeNull();
		expect(hidden.plan.review).not.toContain("Account age");
		expect(hidden.check.summary).not.toContain("Account age");
		expect(hidden.runPageLevel).toBe(8);
		const member = responsePreview(config, outcome, policy(8), "member");
		expect(member.outputs[0]?.body).toContain("Account age");
		expect(member.plan.commentBody).toContain("Account age");
		expect(member.check.summary).toContain("Account age");
		expect(member.runPageLevel).toBe(0);
	});

	test("a sole review uses review redaction for its editable blocks", () => {
		const reviewOnly = redactionPolicySchema.parse({
			level: 8,
			surfaces: ["comment"],
		});
		const preview = responsePreview(
			DEFAULT_RESPONSE_CONFIG,
			outcomeMeta("block"),
			reviewOnly,
			"outsider",
		);
		expect(preview.plan.comment).toBe("delete");
		expect(preview.plan.review).toContain("Account age");
		expect(
			preview.outputs.find((output) => output.block.type === "failed-rules")
				?.body,
		).toContain("Account age");
	});

	test("an added block reaches the comment, the review and the run page", () => {
		const outcome = outcomeMeta("block");
		const before = responsePreview(
			edited([{ id: "a", type: "headline" }]),
			outcome,
			policy(6),
			"outsider",
		);
		expect(before.plan.comment).toBe("delete");
		expect(sampleRunFor(outcome, before.plan, before.check).actions).toEqual([
			expect.objectContaining({ kind: "set-check" }),
			expect.objectContaining({ kind: "block" }),
		]);
		const after = responsePreview(
			edited([
				{ id: "a", type: "headline" },
				{ id: "t", type: "text", parts: [{ kind: "text", text: "Thanks." }] },
			]),
			outcome,
			policy(6),
			"outsider",
		);
		expect(after.plan.comment).toBe("upsert");
		expect(after.plan.commentBody).toContain("Thanks.");
		expect(after.plan.review).toBe("Blocked. See the comment.");
		expect(
			sampleRunFor(outcome, after.plan, after.check).actions.map(
				(action) => action.kind,
			),
		).toEqual(["set-check", "block", "comment"]);
	});

	test("the run page follows the outcome", () => {
		const outcome = outcomeMeta("note");
		const preview = responsePreview(
			DEFAULT_RESPONSE_CONFIG,
			outcome,
			policy(0),
			"outsider",
		);
		const run = sampleRunFor(outcome, preview.plan, preview.check);
		expect(run.verdict).toBe("pass");
		expect(run.workflows.map((workflow) => workflow.outcome)).toEqual(["pass"]);
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
