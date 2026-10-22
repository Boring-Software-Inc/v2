import { describe, expect, test } from "bun:test";
import {
	type CommentInput,
	type CommentReason,
	checkSummary,
	DEFAULT_RESPONSE_CONFIG,
	planSurfaces,
	redactionPolicySchema,
} from "@tripwire/contracts";
import { toFullRunView, toPublicRunView } from "#/lib/run-access";
import {
	branchSummary,
	buildBranches,
	buildRunChain,
	formatOffset,
	outcomeChips,
	ruleReason,
} from "#/lib/run-chain";
import type {
	RunStepView,
	RunView,
	RunWorkflowView,
} from "#/lib/runs.functions";

const AT = "2026-10-21T14:02:07.000Z";

function rule(
	nodeId: string,
	ruleRef: string,
	status: string,
	summary: string | null = null,
	startedAt = AT,
): RunStepView {
	return {
		id: nodeId,
		nodeId,
		nodeKind: "rule",
		ruleRef,
		status,
		evidence: null,
		output: null,
		durationMs: 1,
		startedAt,
		publicEvidence: null,
		summary,
	};
}

const RULES: RunWorkflowView = {
	id: "default@1",
	name: "Rules",
	outcome: "block",
};
const SOLAR: RunWorkflowView = {
	id: "wf-solar",
	name: "solar-lighthouse",
	outcome: "review",
};

function view(overrides: Partial<RunView> = {}): RunView {
	return {
		id: "run-1",
		repoFullName: "acme/scratch",
		subjectNumber: 91,
		subjectKind: "change-request",
		headSha: "3f9a2c1aa",
		status: "completed",
		verdict: "block",
		createdAt: AT,
		completedAt: "2026-10-21T14:02:09.700Z",
		snapshot: null,
		access: "full",
		rerun: false,
		rerunBy: null,
		orgSlug: null,
		repoName: null,
		forge: "github",
		subjectUrl: null,
		canRerun: false,
		stepsHidden: false,
		steps: [
			rule("default@1:spam", "spam-forks@1", "pass"),
			rule("default@1:ai", "ai-review@2", "fail", "Crypto donation spam"),
			rule("wf-solar:age", "account-age@1", "pass"),
			rule("wf-solar:crypto", "crypto-address@1", "fail", "It adds 2 wallets."),
		],
		actions: [
			{
				kind: "comment",
				status: "executed",
				recordedAt: AT,
				url: "https://github.com/acme/scratch/pull/91#issuecomment-5",
			},
			{
				kind: "set-check",
				status: "executed",
				recordedAt: AT,
				url: "https://github.com/acme/scratch/runs/9",
			},
			{ kind: "block", status: "executed", recordedAt: AT, url: null },
			{
				kind: "webhook",
				status: "executed",
				recordedAt: AT,
				url: null,
				delivery: { state: "sent" },
			},
		],
		redactionLevel: 0,
		event: {
			kind: "change-request.opened",
			actor: "g-r-i-m",
			title: "Add donate links",
			headSha: "3f9a2c1aa",
			at: AT,
		},
		workflows: [RULES, SOLAR],
		reviews: [
			{
				workflowId: "wf-solar",
				state: "open",
				degraded: false,
				openedAt: AT,
				decidedAt: null,
				decidedBy: null,
			},
		],
		previousRun: null,
		nextRun: null,
		...overrides,
	};
}

describe("formatOffset", () => {
	test("reads in the unit that fits", () => {
		expect(formatOffset(0)).toBe("+0ms");
		expect(formatOffset(2700)).toBe("+2.7s");
		expect(formatOffset(30_000)).toBe("+30s");
		expect(formatOffset(22 * 60_000)).toBe("+22m");
	});
});

describe("buildRunChain, a scheduled run", () => {
	test("reads as matched by schedule with a clock", () => {
		const chain = buildRunChain(
			view({
				subjectKind: "issue",
				event: {
					kind: "schedule.matched",
					actor: "octocat",
					title: "Crash on start",
					headSha: null,
					at: AT,
				},
			}),
		);
		expect(chain.event.title).toBe("Matched by schedule");
		expect(chain.event.glyph).toBe("scheduled");
		expect(chain.event.detail).toBe("Crash on start");
	});
});

describe("buildRunChain, a blocked run with two workflows", () => {
	const chain = buildRunChain(view());

	test("the event says who opened what", () => {
		expect(chain.event.title).toBe("g-r-i-m opened #91");
		expect(chain.event.detail).toBe("Add donate links");
	});

	test("the checks node counts across every workflow", () => {
		expect(chain.checks?.title).toBe("2 of 4 rules did not pass");
		expect(chain.checks?.tone).toBe("fail");
		expect(chain.checks?.offsetMs).toBe(0);
	});

	test("two failing branches sit side by side, Rules first", () => {
		const body = chain.checks?.body;
		expect(body?.kind).toBe("branches");
		if (body?.kind !== "branches") {
			return;
		}
		expect(body.layout).toBe("side");
		expect(body.branches.map((b) => b.name)).toEqual([
			"Rules",
			"solar-lighthouse",
		]);
		expect(body.branches.map((b) => b.form)).toEqual(["card", "card"]);
		expect(body.showBranchOutcome).toBe(true);
	});

	test("one outcome, with the open review from the other branch under it", () => {
		expect(chain.outcome.title).toBe("Blocked by Rules");
		expect(chain.outcome.tone).toBe("fail");
		expect(chain.outcome.offsetMs).toBe(2700);
		expect(chain.outcome.openReview).toEqual({ name: "solar-lighthouse" });
		expect(chain.steps).toEqual([]);
	});

	test("chips say what tripwire did, check first, and link where they can", () => {
		expect(chain.outcome.chips.map((chip) => [chip.label, chip.href])).toEqual([
			["Check blocked", "https://github.com/acme/scratch/runs/9"],
			["Requested changes", null],
			["Commented", "https://github.com/acme/scratch/pull/91#issuecomment-5"],
			["Sent to a webhook", null],
		]);
	});
});

describe("outcome offset", () => {
	test("a run waiting for review reads from when the review opened", () => {
		const chain = buildRunChain(
			view({
				status: "paused",
				verdict: "needs_review",
				completedAt: null,
				reviews: [
					{
						workflowId: "wf-solar",
						state: "open",
						degraded: false,
						openedAt: "2026-10-21T14:24:07.000Z",
						decidedAt: null,
						decidedBy: null,
					},
				],
			}),
		);
		expect(chain.outcome.title).toBe("Waiting for human review");
		expect(chain.outcome.offsetMs).toBe(22 * 60_000);
	});

	test("a run that did not finish reads from its last step", () => {
		const chain = buildRunChain(
			view({
				status: "failed",
				verdict: null,
				completedAt: null,
				reviews: [],
				steps: [
					rule(
						"default@1:spam",
						"spam-forks@1",
						"pass",
						null,
						"2026-10-21T14:02:08.000Z",
					),
				],
			}),
		);
		expect(chain.outcome.title).toBe("Did not finish");
		expect(chain.outcome.offsetMs).toBe(1001);
	});

	test("a waiting run keeps its offset when redaction hides the steps", () => {
		for (const level of [0, 6, 7, 8]) {
			const chain = buildRunChain(
				toPublicRunView(
					view({
						status: "paused",
						verdict: "needs_review",
						completedAt: null,
					}),
					level,
				),
			);
			expect(chain.outcome.offsetMs).toBe(0);
		}
	});
});

describe("branch grouping", () => {
	const passing = (id: string, name: string): RunWorkflowView => ({
		id,
		name,
		outcome: "pass",
	});

	test("three or more stack, passed workflows fold into one group", () => {
		const body = buildBranches(
			[RULES, SOLAR, passing("a", "docs-only"), passing("b", "size-limit")],
			[
				rule("default@1:ai", "ai-review@2", "fail"),
				rule("wf-solar:crypto", "crypto-address@1", "fail"),
				rule("a:age", "account-age@1", "pass"),
				rule("b:size", "max-files-changed@1", "pass"),
			],
			false,
		);
		expect(body.layout).toBe("stack");
		expect(body.branches.map((b) => b.name)).toEqual([
			"Rules",
			"solar-lighthouse",
		]);
		expect(body.passedGroup.map((b) => b.name)).toEqual([
			"docs-only",
			"size-limit",
		]);
	});

	test("a passing Rules branch folds to a row when another branch holds", () => {
		const body = buildBranches(
			[{ ...RULES, outcome: "pass" }, SOLAR],
			[
				rule("default@1:age", "account-age@1", "pass"),
				rule("wf-solar:crypto", "crypto-address@1", "fail"),
			],
			false,
		);
		expect(body.branches.map((b) => [b.name, b.form])).toEqual([
			["Rules", "row"],
			["solar-lighthouse", "card"],
		]);
		expect(body.layout).toBe("stack");
	});

	test("when everything passed, every workflow folds into the group", () => {
		const body = buildBranches(
			[{ ...RULES, outcome: "pass" }, passing("a", "docs-only")],
			[
				rule("default@1:age", "account-age@1", "pass"),
				rule("a:size", "max-files-changed@1", "pass"),
			],
			false,
		);
		expect(body.branches).toEqual([]);
		expect(body.passedGroup.map((b) => b.name)).toEqual(["Rules", "docs-only"]);
	});

	test("a rules-only run is one card with no branch outcome", () => {
		const body = buildBranches(
			[RULES],
			[rule("account-age", "account-age@1", "fail")],
			false,
		);
		expect(body.branches.map((b) => b.form)).toEqual(["card"]);
		expect(body.showBranchOutcome).toBe(false);
	});

	test("a row summary names what did not pass", () => {
		const body = buildBranches(
			[RULES],
			[
				rule("default@1:ai", "ai-review@2", "fail"),
				rule("default@1:main", "account-age@1", "fail"),
			],
			true,
		);
		const branch = body.branches[0];
		expect(branch?.form).toBe("row");
		expect(branch ? branchSummary(branch).text : "").toBe(
			"AI review and Account age did not pass",
		);
	});
});

describe("human review decisions", () => {
	const decided = view({
		verdict: "pass",
		completedAt: "2026-10-21T14:24:07.000Z",
		workflows: [{ ...RULES, outcome: "pass" }, SOLAR],
		reviews: [
			{
				workflowId: "wf-solar",
				state: "approved",
				degraded: false,
				openedAt: "2026-10-21T14:02:07.400Z",
				decidedAt: "2026-10-21T14:24:07.000Z",
				decidedBy: "caleb",
			},
		],
	});

	test("the hold and the decision are their own nodes, then the outcome", () => {
		const chain = buildRunChain(decided);
		expect(chain.steps.map((step) => [step.title, step.tone])).toEqual([
			["Human review", "neutral"],
			["Approved by caleb", "ok"],
		]);
		expect(chain.steps[1]?.offsetMs).toBe(22 * 60_000);
		expect(chain.outcome.title).toBe("Passed");
	});

	test("the public sees the decision, not who made it", () => {
		const chain = buildRunChain(toPublicRunView(decided, 0));
		expect(chain.steps[1]?.title).toBe("Approved by a maintainer");
	});

	test("after a decision every branch folds to a row", () => {
		const body = buildRunChain(decided).checks?.body;
		expect(
			body?.kind === "branches" && body.branches.every((b) => b.form === "row"),
		).toBe(true);
	});

	test("a maintainer block reads as blocked, not blocked by a workflow", () => {
		const chain = buildRunChain(
			view({
				reviews: [
					{
						workflowId: "wf-solar",
						state: "denied",
						degraded: false,
						openedAt: AT,
						decidedAt: AT,
						decidedBy: "caleb",
					},
				],
			}),
		);
		expect(chain.steps[1]?.title).toBe("Blocked by caleb");
		expect(chain.outcome.title).toBe("Blocked");
	});

	test("an open review is the outcome when nothing blocked", () => {
		const chain = buildRunChain(
			view({ verdict: "needs_review", status: "paused" }),
		);
		expect(chain.outcome.title).toBe("Waiting for human review");
		expect(chain.outcome.tone).toBe("neutral");
		expect(chain.outcome.openReview).toBeNull();
	});

	test("a degraded run says tripwire could not finish", () => {
		const chain = buildRunChain(
			view({
				verdict: "needs_review",
				status: "paused",
				reviews: [
					{
						workflowId: null,
						state: "open",
						degraded: true,
						openedAt: AT,
						decidedAt: null,
						decidedBy: null,
					},
				],
			}),
		);
		expect(chain.outcome.title).toBe("Waiting for human review");
		expect(chain.outcome.detail).toBe("Tripwire could not check every rule.");
	});
});

describe("re-runs and superseded runs", () => {
	test("a newer run on the same change request supersedes this one", () => {
		const chain = buildRunChain(
			view({
				nextRun: {
					id: "run-2",
					createdAt: "2026-10-21T14:12:07.000Z",
					status: "completed",
					verdict: "pass",
					eventKind: "change-request.updated",
					actor: "g-r-i-m",
					headSha: "3f9a2c1ffff",
					rerun: false,
				},
			}),
		);
		expect(chain.outcome.title).toBe("Superseded");
		expect(chain.outcome.detail).toBe("g-r-i-m pushed 3f9a2c1.");
		expect(chain.outcome.chips).toEqual([
			{
				key: "next-run-2",
				label: "Newer run passed",
				glyph: "pass",
				tone: "ok",
				href: "run-2",
				internal: true,
			},
		]);
		expect(chain.steps.map((step) => step.title)).toEqual(["Blocked by Rules"]);
	});

	test("a push says what was pushed and which run it replaces", () => {
		const previous = {
			id: "run-0",
			createdAt: AT,
			status: "completed",
			verdict: "block" as const,
			eventKind: "change-request.opened" as const,
			actor: "g-r-i-m",
			headSha: "aaaa",
			rerun: false,
		};
		const chain = buildRunChain(
			view({
				previousRun: previous,
				event: {
					kind: "change-request.updated",
					actor: "g-r-i-m",
					title: null,
					headSha: "3f9a2c1aa",
					at: AT,
				},
			}),
		);
		expect(chain.event.title).toBe("g-r-i-m pushed 3f9a2c1 to #91");
		expect(chain.event.replaces?.id).toBe("run-0");
	});

	test("a manual re-run names the admin only for members", () => {
		const rerun = view({ rerun: true, rerunBy: "Grim" });
		expect(buildRunChain(toFullRunView(rerun)).event.title).toBe(
			"Grim re-ran the rules on #91",
		);
		expect(buildRunChain(toPublicRunView(rerun, 0)).event.title).toBe(
			"Rules re-run on #91",
		);
	});
});

describe("redaction", () => {
	test("level 5 shows the rule name and nothing under it", () => {
		const publicView = toPublicRunView(view(), 5);
		const body = buildRunChain(publicView).checks?.body;
		const flagged =
			body?.kind === "branches"
				? body.branches.flatMap((branch) => branch.flagged)
				: [];
		expect(flagged.length).toBe(2);
		for (const rule of flagged) {
			expect(ruleReason(rule, 5)).toBeNull();
		}
	});

	test("a passed rule shows no sentence at any level", () => {
		const steps = [
			rule(
				"default@1:english",
				"english-only@1",
				"pass",
				"Most of the title is not written in the Latin alphabet.",
			),
		];
		const body = buildRunChain(view({ steps, workflows: [RULES] })).checks
			?.body;
		const passed = body?.kind === "branches" ? body.branches[0]?.passed : [];
		expect(passed?.length).toBe(1);
		for (const level of [0, 4]) {
			for (const passedRule of passed ?? []) {
				expect(ruleReason(passedRule, level)).toBeNull();
			}
		}
	});

	test("level 6 is one node with the marks in run order, no names, no chips", () => {
		const chain = buildRunChain(toPublicRunView(view(), 6));
		expect(chain.checks?.title).toBe("2 of 4 rules did not pass");
		expect(chain.checks?.body).toEqual({
			kind: "marks",
			marks: ["pass", "fail", "pass", "fail"],
		});
		expect(chain.outcome.title).toBe("Blocked");
		expect(chain.outcome.openReview).toEqual({ name: null });
		expect(chain.outcome.chips).toEqual([]);
	});

	test("level 7 keeps the failed count and drops the passed count", () => {
		const chain = buildRunChain(toPublicRunView(view(), 7));
		expect(chain.checks?.title).toBe("2 rules did not pass");
		expect(chain.checks?.body).toEqual({ kind: "none" });
		expect(chain.outcome.openReview).toEqual({ name: null });
	});

	test("level 8 goes straight from the event to the outcome", () => {
		const chain = buildRunChain(toPublicRunView(view(), 8));
		expect(chain.checks).toBeNull();
		expect(chain.outcome.title).toBe("Blocked");
		expect(chain.outcome.openReview).toBeNull();
	});

	test("the run page and GitHub state the failed count at the same levels", () => {
		const reasons: CommentReason[] = [
			{ text: "Crypto donation spam", remedy: "revise", ruleId: "ai-review" },
			{
				text: "It adds 2 wallets.",
				remedy: "revise",
				ruleId: "crypto-address",
			},
		];
		const input: CommentInput = {
			verdict: "block",
			contributorLogin: "g-r-i-m",
			reasons,
			runUrl: "https://tripwire.sh/runs/run-1",
		};
		const expected = [
			"2 of 4 rules did not pass",
			"2 of 4 rules did not pass",
			"2 of 4 rules did not pass",
			"2 of 4 rules did not pass",
			"2 of 4 rules did not pass",
			"2 of 4 rules did not pass",
			"2 of 4 rules did not pass",
			"2 rules did not pass",
			null,
		];
		for (const [level, title] of expected.entries()) {
			const chain = buildRunChain(toPublicRunView(view(), level));
			const policy = redactionPolicySchema.parse({ level });
			const review =
				planSurfaces(input, DEFAULT_RESPONSE_CONFIG, policy, {
					reviewPosted: true,
				}).review ?? "";
			const check = checkSummary("block", reasons, false, level);
			expect(chain.checks?.title ?? null).toBe(title);
			if (level >= 5 && level <= 7) {
				expect(review).toContain("2 rules did not pass");
			}
			if (level === 6 || level === 7) {
				expect(check).toBe("Blocked by 2 rules.");
			}
			if (level === 8) {
				expect(review).not.toContain("did not pass");
				expect(check).toBe("Blocked.");
			}
		}
	});

	test("members see every chip at any level", () => {
		const labels = outcomeChips(toFullRunView(view())).map((c) => c.label);
		expect(labels).toContain("Sent to a webhook");
	});
});
