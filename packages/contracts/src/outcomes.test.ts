import { describe, expect, test } from "bun:test";
import {
	type CommentReason,
	checkSummary,
	FIX_FALLBACK,
	fixText,
	renderVerdictComment,
} from "./comment-render.ts";
import { OPEN_REDACTION } from "./redaction.ts";
import { DEFAULT_RESPONSE_CONFIG, wantsComment } from "./response.ts";
import { nonEnforcingRuleNodeIds, runOutcomes } from "./run-outcome.ts";
import { describeRunSteps } from "./run-steps.ts";
import { joinVerdicts, standingVerdict } from "./verdict-join.ts";
import type { WorkflowDefinition } from "./workflow.ts";
import { workflowAuthoring } from "./workflow-authoring-catalog.ts";
import { compileWorkflows } from "./workflow-compile.ts";
import { foldUnless } from "./workflow-connections.ts";
import { lintWorkflow } from "./workflow-lint.ts";

const RUN_URL = "https://tripwire.sh/runs/r1";

describe("verdict join", () => {
	test("join order: close > block > changes_required > needs_review > pass", () => {
		expect(joinVerdicts(["pass", "needs_review", "changes_required"])).toBe(
			"changes_required",
		);
		expect(joinVerdicts(["changes_required", "block"])).toBe("block");
		expect(joinVerdicts(["block", "close", "needs_review"])).toBe("close");
		expect(joinVerdicts([])).toBe("pass");
		expect(
			standingVerdict({ closes: 0, blocks: 0, fixes: 1, reviewsPending: 1 }),
		).toBe("changes_required");
		expect(
			standingVerdict({ closes: 0, blocks: 0, fixes: 0, reviewsPending: 1 }),
		).toBe("needs_review");
		expect(
			standingVerdict({ closes: 0, blocks: 0, fixes: 0, reviewsPending: 0 }),
		).toBe("pass");
	});
});

describe("Except when", () => {
	test("passes when either side passes, otherwise keeps the requirement", () => {
		expect(foldUnless("pass", "fail")).toEqual({
			outcome: "pass",
			exceptionApplied: false,
		});
		expect(foldUnless("fail", "pass")).toEqual({
			outcome: "pass",
			exceptionApplied: true,
		});
		expect(foldUnless("fail", "skipped")).toEqual({
			outcome: "fail",
			exceptionApplied: false,
		});
		expect(foldUnless("fail", undefined)).toEqual({
			outcome: "fail",
			exceptionApplied: false,
		});
		expect(foldUnless("skipped", "fail")).toEqual({
			outcome: "skipped",
			exceptionApplied: false,
		});
		expect(foldUnless("skipped", "pass")).toEqual({
			outcome: "pass",
			exceptionApplied: false,
		});
	});

	test("unless compiles from tripwire.ts", () => {
		const { customCheck, unless, workflow, workflows, requestFix } =
			workflowAuthoring;
		const broken = compileWorkflows(
			workflows({
				w: workflow({
					on: "change-request.opened",
					check: unless(customCheck("custom-a"), customCheck("custom-b")),
					fail: [requestFix({ message: "Fix it." })],
				}),
			}),
		);
		expect(broken.ok).toBe(true);
	});

	const GATE: WorkflowDefinition = {
		id: "w",
		name: "w",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "a", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
			{ id: "b", type: "rule", ref: "crypto-address@1", config: {} },
			{ id: "u", type: "gate", mode: "unless" },
			{ id: "x", type: "action", action: "block" },
		],
		edges: [
			{ id: "1", from: "t", to: "a" },
			{ id: "2", from: "t", to: "b" },
			{ id: "3", from: "a", to: "u", input: "requirement" },
			{ id: "4", from: "b", to: "u", input: "exception" },
			{ id: "5", from: "u", to: "x", when: "fail" },
		],
	};

	test("lint accepts a wired gate and refuses a gate with an unnamed input", () => {
		expect(
			lintWorkflow(GATE).filter((issue) => issue.rule === "unless-inputs"),
		).toEqual([]);
		const unnamed = {
			...GATE,
			edges: GATE.edges.map((edge) =>
				edge.id === "4" ? { id: "4", from: "b", to: "u" } : edge,
			),
		};
		expect(lintWorkflow(unnamed).map((issue) => issue.rule)).toContain(
			"unless-inputs",
		);
		const stray = {
			...GATE,
			edges: GATE.edges.map((edge) =>
				edge.id === "5" ? { ...edge, input: "exception" as const } : edge,
			),
		};
		expect(lintWorkflow(stray).map((issue) => issue.rule)).toContain(
			"unless-inputs",
		);
	});

	test("an exception probe never counts toward the degraded floor", () => {
		expect([...nonEnforcingRuleNodeIds(GATE)]).toEqual(["b"]);
	});

	test("the run page names the exception decision", () => {
		const views = describeRunSteps(
			[GATE],
			[
				{
					nodeId: "w:u",
					nodeKind: "gate",
					ruleId: null,
					status: "pass",
					summary: null,
					output: {
						outcome: "pass",
						requirement: "fail",
						exception: "pass",
						exceptionApplied: true,
					},
				},
			],
		);
		expect(views[0]).toMatchObject({
			gate: "except when",
			outcome: "Exception applied",
			summary:
				"The requirement did not pass. The exception applied, so it is waived.",
		});
		const missing = describeRunSteps(
			[GATE],
			[
				{
					nodeId: "w:u",
					nodeKind: "gate",
					ruleId: null,
					status: "fail",
					summary: null,
					output: {
						outcome: "fail",
						requirement: "fail",
						exception: "skipped",
						exceptionApplied: false,
					},
				},
			],
		);
		expect(missing[0]?.summary).toBe(
			"The requirement did not pass. The exception could not be checked, so it does not apply.",
		);
	});
});

describe("issue attribution", () => {
	const DEF: WorkflowDefinition = {
		id: "w",
		name: "w",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "target", type: "rule", ref: "custom-target@1", config: {} },
			{ id: "release", type: "rule", ref: "custom-release@1", config: {} },
			{ id: "u", type: "gate", mode: "unless" },
			{
				id: "fix",
				type: "action",
				action: "request-fix",
				params: { message: "Change the target to main." },
			},
			{ id: "crypto", type: "rule", ref: "crypto-address@1", config: {} },
			{ id: "block", type: "action", action: "block" },
			{ id: "readme", type: "rule", ref: "profile-readme@1", config: {} },
			{ id: "note", type: "action", action: "note" },
		],
		edges: [
			{ id: "1", from: "t", to: "target" },
			{ id: "2", from: "t", to: "release" },
			{ id: "3", from: "target", to: "u", input: "requirement" },
			{ id: "4", from: "release", to: "u", input: "exception" },
			{ id: "5", from: "u", to: "fix", when: "fail" },
			{ id: "6", from: "t", to: "crypto" },
			{ id: "7", from: "crypto", to: "block", when: "fail" },
			{ id: "8", from: "t", to: "readme" },
			{ id: "9", from: "readme", to: "note", when: "fail" },
		],
	};

	const step = (
		nodeId: string,
		nodeKind: string,
		status: string,
		rest = {},
	) => ({
		nodeId: `w:${nodeId}`,
		nodeKind,
		status,
		...rest,
	});

	test("a waived requirement and its probe stay out of the block reasons", () => {
		const outcomes = runOutcomes(
			[DEF],
			[
				step("t", "trigger", "pass"),
				step("target", "rule", "fail"),
				step("release", "rule", "pass"),
				step("u", "gate", "pass", {
					output: { outcome: "pass", exceptionApplied: true },
				}),
				step("crypto", "rule", "fail"),
				step("block", "action", "pass"),
			],
		);
		expect([...outcomes.quietRuleStepIds]).toEqual(["w:target"]);
		expect(outcomes.fixes).toEqual([]);
		expect(outcomes.exceptions).toEqual([{ nodeId: "w:u", applied: true }]);
	});

	test("a fix keeps its message and the failing rules it came from", () => {
		const outcomes = runOutcomes(
			[DEF],
			[
				step("t", "trigger", "pass"),
				step("target", "rule", "fail"),
				step("release", "rule", "fail"),
				step("u", "gate", "fail", {
					output: { outcome: "fail", exceptionApplied: false },
				}),
				step("fix", "action", "pass", {
					input: {
						action: "request-fix",
						params: { message: "Change the target to main." },
					},
				}),
				step("readme", "rule", "fail"),
				step("note", "action", "pass", { input: { action: "note" } }),
			],
		);
		expect(outcomes.fixes).toEqual([
			{
				nodeId: "w:fix",
				message: "Change the target to main.",
				ruleStepIds: ["w:target"],
			},
		]);
		expect(outcomes.notes).toEqual([
			{ nodeId: "w:note", message: null, ruleStepIds: ["w:readme"] },
		]);
		expect([...outcomes.quietRuleStepIds].sort()).toEqual([
			"w:readme",
			"w:release",
			"w:target",
		]);
	});

	test("a fix or note behind a check that could not run is not an issue", () => {
		const outcomes = runOutcomes(
			[DEF],
			[
				step("t", "trigger", "pass"),
				step("target", "rule", "skipped"),
				step("release", "rule", "fail"),
				step("u", "gate", "skipped", {
					output: { outcome: "skipped", exceptionApplied: false },
				}),
				step("fix", "action", "skipped"),
				step("readme", "rule", "skipped"),
				step("note", "action", "skipped"),
			],
		);
		expect(outcomes.fixes).toEqual([]);
		expect(outcomes.notes).toEqual([]);
	});

	test("note-only checks never count toward the degraded floor", () => {
		expect([...nonEnforcingRuleNodeIds(DEF)].sort()).toEqual([
			"readme",
			"release",
		]);
	});
});

describe("PR wording", () => {
	const input = {
		contributorLogin: "octo",
		reasons: [] as CommentReason[],
		runUrl: RUN_URL,
	};

	test("wrong target: changes needed with the instruction", () => {
		const body = renderVerdictComment(
			{
				...input,
				verdict: "changes_required",
				fixes: [{ message: "Change the target to main.", reasons: [] }],
			},
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body.startsWith("Changes needed. Change the target to main.")).toBe(
			true,
		);
		expect(
			checkSummary("changes_required", [], false, 0, false, {
				fixes: [{ message: "Change the target to main.", reasons: [] }],
			}),
		).toBe("Changes needed. Change the target to main.");
	});

	test("wrong target plus review appends the pending review", () => {
		const body = renderVerdictComment(
			{
				...input,
				verdict: "changes_required",
				fixes: [{ message: "Change the target to main.", reasons: [] }],
				reviewPending: true,
			},
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(
			body.startsWith(
				"Changes needed. Change the target to main. Human review is pending.",
			),
		).toBe(true);
	});

	test("release exception plus crypto: blocked by crypto only", () => {
		const reasons: CommentReason[] = [
			{
				text: "Crypto address found.",
				remedy: "revise",
				ruleId: "crypto-address",
				ruleName: "Crypto address",
			},
		];
		const body = renderVerdictComment(
			{ ...input, verdict: "block", reasons },
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain("Crypto address found.");
		expect(body).not.toContain("Changes needed.");
		expect(checkSummary("block", reasons)).toBe("Blocked by Crypto address.");
	});

	test("note only: passed with a factual statement", () => {
		const body = renderVerdictComment(
			{ ...input, verdict: "pass", notes: ["No description provided."] },
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(
			body.startsWith(
				"Tripwire passed this change request. No description provided.",
			),
		).toBe(true);
		expect(wantsComment(DEFAULT_RESPONSE_CONFIG, "pass", { notes: true })).toBe(
			true,
		);
		expect(
			wantsComment({ ...DEFAULT_RESPONSE_CONFIG, onNote: "silent" }, "pass", {
				notes: true,
			}),
		).toBe(false);
	});

	test("a block keeps every other active issue in the comment", () => {
		const body = renderVerdictComment(
			{
				...input,
				verdict: "block",
				reasons: [{ text: "Crypto address found.", remedy: "revise" }],
				fixes: [{ message: "Change the target to main.", reasons: [] }],
				reviewPending: true,
				notes: ["No description provided."],
			},
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body).toContain(
			"Changes needed. Change the target to main. Human review is pending.",
		);
		expect(body).toContain("No description provided.");
	});

	test("close: closed with the reason", () => {
		const reasons: CommentReason[] = [
			{
				text: "Your account is 2 days old.",
				remedy: "wait",
				ruleId: "account-age",
				ruleName: "Account age",
			},
		];
		const body = renderVerdictComment(
			{ ...input, verdict: "close", reasons },
			DEFAULT_RESPONSE_CONFIG,
		);
		expect(body.startsWith("Closed.")).toBe(true);
		expect(body).toContain("Your account is 2 days old.");
		expect(checkSummary("close", reasons)).toBe("Closed by Account age.");
	});

	test("a fix with no instruction uses the rule's reason, redacted like any reason", () => {
		const fix = {
			message: null,
			reasons: [
				{
					text: "It adds 0xabc to src/DONATE.md.",
					remedy: "revise" as const,
					ruleId: "crypto-address",
					ruleName: "Crypto address",
				},
			],
		};
		expect(fixText(fix)).toBe("It adds 0xabc to src/DONATE.md.");
		const hidden = fixText(fix, 5);
		expect(hidden).not.toContain("0xabc");
		expect(hidden).not.toContain("DONATE");
		expect(hidden).toBe("This rule did not pass: Crypto address.");
		expect(fixText(fix, 8)).toBe(FIX_FALLBACK);
		const policy = {
			...OPEN_REDACTION,
			level: 5,
			surfaces: ["comment" as const, "check" as const],
		};
		const body = renderVerdictComment(
			{ ...input, verdict: "changes_required", fixes: [fix] },
			DEFAULT_RESPONSE_CONFIG,
			policy,
		);
		expect(body).not.toContain("0xabc");
		expect(
			checkSummary("changes_required", [], false, 5, false, { fixes: [fix] }),
		).not.toContain("0xabc");
	});

	test("the fix comment respects its comment setting", () => {
		expect(
			wantsComment(
				{ ...DEFAULT_RESPONSE_CONFIG, onChangesRequired: "silent" },
				"changes_required",
			),
		).toBe(false);
		expect(wantsComment(DEFAULT_RESPONSE_CONFIG, "changes_required")).toBe(
			true,
		);
	});
});
