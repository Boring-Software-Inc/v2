import { describe, expect, test } from "bun:test";
import {
	isPublicPath,
	resolveRunAccess,
	toFullRunView,
	toPublicRunView,
} from "#/lib/run-access";
import type { RunStepView, RunView } from "#/lib/runs.functions";

/** §10 access model — public read of the judgment, gated everything else. */

describe("resolveRunAccess", () => {
	test("open-dev posture (auth disabled) ⇒ full", () => {
		expect(
			resolveRunAccess({
				authEnabled: false,
				canReadActivity: false,
				repoPrivate: true,
			}),
		).toBe("full");
	});

	test("activity read ⇒ full, regardless of repo visibility", () => {
		expect(
			resolveRunAccess({
				authEnabled: true,
				canReadActivity: true,
				repoPrivate: true,
			}),
		).toBe("full");
	});

	test("no activity read + public repo ⇒ public view, signed in or not", () => {
		expect(
			resolveRunAccess({
				authEnabled: true,
				canReadActivity: false,
				repoPrivate: false,
			}),
		).toBe("public");
	});

	test("no activity read + private repo ⇒ denied", () => {
		expect(
			resolveRunAccess({
				authEnabled: true,
				canReadActivity: false,
				repoPrivate: true,
			}),
		).toBe("denied");
	});

	test("no activity read + unknown visibility ⇒ denied (fail closed)", () => {
		expect(
			resolveRunAccess({
				authEnabled: true,
				canReadActivity: false,
				repoPrivate: null,
			}),
		).toBe("denied");
	});
});

describe("isPublicPath", () => {
	test("the run page and /login are public", () => {
		expect(isPublicPath("/login")).toBe(true);
		expect(isPublicPath("/runs/019f54d3-0c13-7000-930a-dc97f87e1d5e")).toBe(
			true,
		);
		expect(isPublicPath("/runs/019f54d3-0c13-7000-930a-dc97f87e1d5e/")).toBe(
			true,
		);
	});

	test("list and index routes stay gated (redirect to /login)", () => {
		for (const path of [
			"/",
			"/activity",
			"/moderation",
			"/rules",
			"/workflows",
			"/analytics",
			"/runs",
			"/runs/",
			"/runs/abc/steps",
		]) {
			expect(isPublicPath(path)).toBe(false);
		}
	});
});

const aiReviewStep: RunStepView = {
	id: "step-2",
	nodeId: "default@1:ai-review-1",
	nodeKind: "rule",
	ruleRef: "ai-review@1",
	status: "failed",
	evidence: {
		ruleId: "ai-review",
		version: 1,
		status: "evaluated",
		passed: false,
		evaluatedAt: "2026-07-11T00:00:00.000Z",
		evidence: {
			output: {
				verdict: "block",
				confidence: 1,
				summary: "exfiltrates tokens in ci.",
				findings: [
					{
						severity: "critical",
						file: ".github/workflows/ci.yml",
						line: 12,
						note: "posts secrets to an external host",
					},
				],
			},
			trace: { steps: 4, tokens: 9000, messages: ["internal"] },
		},
	},
	output: null,
	durationMs: 1200,
	startedAt: "2026-07-11T00:00:00.000Z",
	publicEvidence: {
		output: {
			verdict: "block",
			confidence: 1,
			summary: "exfiltrates tokens in ci.",
			findings: [
				{
					severity: "critical",
					file: ".github/workflows/ci.yml",
					line: 12,
					note: "posts secrets to an external host",
				},
			],
		},
	},
	summary: "exfiltrates tokens in ci.",
};

const ruleStep: RunStepView = {
	id: "step-1",
	nodeId: "default@1:account-age-1",
	nodeKind: "rule",
	ruleRef: "account-age@1",
	status: "failed",
	evidence: {
		ruleId: "account-age",
		version: 1,
		status: "evaluated",
		passed: false,
		evaluatedAt: "2026-07-11T00:00:00.000Z",
		evidence: { accountAgeDays: 1, minDays: 30 },
	},
	output: null,
	durationMs: 3,
	startedAt: "2026-07-11T00:00:00.000Z",
	publicEvidence: { accountAgeDays: 1 },
	summary: "this account is 1 days old",
};

const fullView: RunView = {
	id: "run-1",
	repoFullName: "acme/pub",
	subjectNumber: 7,
	subjectKind: "change-request",
	headSha: "abc1234def",
	status: "completed",
	verdict: "block",
	createdAt: "2026-07-11T00:00:00.000Z",
	completedAt: "2026-07-11T00:00:01.000Z",
	snapshot: [{ id: "default@1" }],
	access: "full",
	rerun: true,
	rerunBy: "Maintainer",
	orgSlug: "acme",
	repoName: "pub",
	forge: "github",
	subjectUrl: null,
	canRerun: true,
	stepsHidden: false,
	steps: [ruleStep, aiReviewStep],
	actions: [
		{
			kind: "block",
			status: "executed",
			recordedAt: "2026-07-11T00:00:01.000Z",
			url: null,
		},
		{
			kind: "discord",
			status: "executed",
			recordedAt: "2026-07-11T00:00:01.000Z",
			url: null,
			delivery: { state: "sent" },
		},
	],
	redactionLevel: 0,
	event: {
		kind: "change-request.opened",
		actor: "someone",
		title: "add a wallet",
		headSha: "abc1234def",
		at: "2026-07-11T00:00:00.000Z",
	},
	workflows: [
		{ id: "default@1", name: "Rules", outcome: "block" },
		{ id: "wf-crypto", name: "crypto-guard", outcome: "review" },
	],
	reviews: [
		{
			workflowId: "wf-crypto",
			state: "approved",
			degraded: false,
			openedAt: "2026-07-11T00:00:01.000Z",
			decidedAt: "2026-07-11T00:10:00.000Z",
			decidedBy: "caleb",
		},
	],
	previousRun: null,
	nextRun: null,
	backfill: false,
	aiReviewNotRun: false,
};

describe("toPublicRunView", () => {
	const publicView = toPublicRunView(fullView);

	test("swaps in the stored public evidence + one-liner, drops the threshold", () => {
		expect(publicView.access).toBe("public");
		expect(publicView.verdict).toBe("block");
		const inner = (publicView.steps[0]?.evidence as { evidence: unknown })
			.evidence;
		expect(inner).toEqual({ accountAgeDays: 1 });
		expect(publicView.steps[0]?.summary).toBe("this account is 1 days old");
		// the configured threshold (minDays) never reaches the public view.
		expect(JSON.stringify(publicView.steps[0])).not.toContain("minDays");
		// the carrier field is not echoed back out.
		expect(publicView.steps[0]?.publicEvidence).toBeUndefined();
	});

	test("keeps the re-run FACT, drops the actor (§10)", () => {
		expect(publicView.rerun).toBe(true);
		expect(publicView.rerunBy).toBeNull();
		// the full view keeps both.
		expect(toFullRunView(fullView).rerunBy).toBe("Maintainer");
	});

	test("strips the re-run SCOPE — deciding is gated (§6/§10)", () => {
		expect(publicView.orgSlug).toBeNull();
		expect(publicView.repoName).toBeNull();
		expect(publicView.canRerun).toBe(false);
		// the full view carries the scope the admin re-run needs.
		const full = toFullRunView(fullView);
		expect(full.orgSlug).toBe("acme");
		expect(full.repoName).toBe("pub");
		expect(full.canRerun).toBe(true);
	});

	test("keeps ai-review findings + summary, drops the raw trace and snapshot", () => {
		const aiEvidence = publicView.steps[1]?.evidence as {
			evidence: { output: { findings: unknown[] } };
		};
		expect(aiEvidence.evidence.output.findings).toHaveLength(1);
		expect(publicView.steps[1]?.summary).toBe("exfiltrates tokens in ci.");
		expect(JSON.stringify(publicView)).not.toContain("trace");
		expect(publicView.snapshot).toBeNull();
	});

	test("does not mutate the full view", () => {
		expect(JSON.stringify(fullView)).toContain("trace");
		expect(JSON.stringify(fullView)).toContain("minDays");
		expect(fullView.access).toBe("full");
	});
});

/**
 * §10 leak invariant — the mechanical proof that a stranger never sees a repo's
 * tuning. The public run page renders exactly `toPublicRunView`'s output (the
 * getRun server-fn response it fetches), so asserting the projection is the
 * proof: NO configured threshold key and NO raw trace may survive to public.
 */
describe("§10 leak invariant — no repo tuning reaches a stranger", () => {
	/** Every config-threshold key a stranger must never see, plus the raw trace. */
	const LEAK_TOKENS = [
		"minDays",
		"maxPerWindow",
		"windowHours",
		"max",
		"minLength",
		"trace",
	];

	// A run that tuned several rules: the thresholds live in the workflow
	// snapshot AND echo into each rule's raw evidence; the ai-review step carries
	// its raw trace. The stored public partitions carry none of it.
	const tunedRuleStep: RunStepView = {
		...ruleStep,
		evidence: {
			ruleId: "account-age",
			version: 1,
			status: "evaluated",
			passed: false,
			evaluatedAt: "2026-07-11T00:00:00.000Z",
			evidence: {
				accountAgeDays: 1,
				minDays: 30,
				maxPerWindow: 5,
				windowHours: 24,
				max: 500,
				minLength: 20,
			},
		},
		publicEvidence: { accountAgeDays: 1 },
	};

	const tunedView: RunView = {
		...fullView,
		snapshot: [
			{
				id: "default@1",
				config: {
					minDays: 30,
					maxPerWindow: 5,
					windowHours: 24,
					max: 500,
					minLength: 20,
				},
			},
		],
		steps: [tunedRuleStep, aiReviewStep],
	};

	const publicJson = JSON.stringify(toPublicRunView(tunedView));
	const fullJson = JSON.stringify(tunedView);

	for (const token of LEAK_TOKENS) {
		test(`the public run view leaks no "${token}"`, () => {
			// Teeth: the token IS in the full (maintainer) view, so a passing
			// public assertion is meaningful — never vacuously green.
			expect(fullJson).toContain(token);
			expect(publicJson).not.toContain(token);
		});
	}

	test("the public view carries no workflow snapshot at all", () => {
		expect(toPublicRunView(tunedView).snapshot).toBeNull();
	});
});

describe("toFullRunView", () => {
	test("session view is unchanged raw evidence — publicEvidence stripped, summary kept", () => {
		const full = toFullRunView(fullView);
		expect(full.access).toBe("full");
		// full raw evidence (thresholds + trace) intact for the maintainer.
		expect(JSON.stringify(full)).toContain("minDays");
		expect(JSON.stringify(full)).toContain("trace");
		// the publicEvidence carrier never ships; but the plain-English summary
		// stays — the run page shows it (quiet on pass, the statement on fail).
		expect(full.steps[0]?.publicEvidence).toBeUndefined();
		expect(full.steps[0]?.summary).toBe("this account is 1 days old");
	});
});

describe("toPublicRunView redaction", () => {
	const failed = { ...aiReviewStep, status: "fail" };
	const passed = { ...ruleStep, id: "step-3", status: "pass" };
	const trigger: RunStepView = {
		...ruleStep,
		id: "step-0",
		nodeKind: "trigger",
		ruleRef: null,
		label: "trigger",
	};
	const view: RunView = { ...fullView, steps: [trigger, passed, failed] };

	function aiInner(level: number) {
		const step = toPublicRunView(view, level).steps.find(
			(s) => s.id === failed.id,
		);
		return (step?.evidence as { evidence: unknown } | undefined)?.evidence;
	}

	test("stop 0 keeps the public partition as stored", () => {
		expect(aiInner(0)).toEqual(aiReviewStep.publicEvidence);
	});

	test("stop 2 strips finding notes and file paths", () => {
		expect(aiInner(2)).toEqual({
			output: {
				verdict: "block",
				confidence: 1,
				summary: "exfiltrates tokens in ci.",
				findings: [{ severity: "critical" }],
			},
		});
	});

	test("stop 3 hides all evidence, stop 4 swaps the AI summary", () => {
		expect(aiInner(3)).toBeNull();
		const step = toPublicRunView(view, 4).steps.find((s) => s.id === failed.id);
		expect(step?.summary).toBe(
			"This change request has problems a reviewer would flag.",
		);
	});

	test("stop 6 hides rule identity and workflow steps", () => {
		const steps = toPublicRunView(view, 6).steps;
		expect(steps.map((s) => s.id)).toEqual([passed.id, failed.id]);
		for (const step of steps) {
			expect(step.ruleRef).toBeNull();
			expect(step.ruleName).toBeNull();
			expect(step.summary).toBeNull();
		}
	});

	test("stop 6 drops workflow names and the step node ids that carry them", () => {
		const atFive = toPublicRunView(view, 5);
		expect(atFive.workflows).toEqual(fullView.workflows);
		expect(atFive.reviews[0]?.workflowId).toBe("wf-crypto");
		const atSix = toPublicRunView(view, 6);
		expect(atSix.workflows).toEqual([]);
		expect(atSix.reviews[0]?.workflowId).toBeNull();
		expect(atSix.steps.map((s) => s.nodeId)).toEqual(["step-0", "step-1"]);
		expect(JSON.stringify(atSix)).not.toContain("crypto-guard");
	});

	test("the public view never names the maintainer who decided", () => {
		expect(toPublicRunView(view, 0).reviews[0]?.decidedBy).toBeNull();
		expect(toFullRunView(view).reviews[0]?.decidedBy).toBe("caleb");
	});

	test("the public view carries its redaction level", () => {
		expect(toPublicRunView(view, 5).redactionLevel).toBe(5);
		expect(toFullRunView({ ...view, redactionLevel: 5 }).redactionLevel).toBe(
			0,
		);
	});

	test("discord and webhook sends stay with members", () => {
		const kinds = toPublicRunView(view, 0).actions.map((a) => a.kind);
		expect(kinds).toEqual(["block"]);
		expect(toFullRunView(view).actions.map((a) => a.kind)).toEqual([
			"block",
			"discord",
		]);
	});

	test("the actions list hides from stop 6 for the public", () => {
		expect(toPublicRunView(view, 5).actions).toEqual(
			fullView.actions.filter((a) => a.kind === "block"),
		);
		expect(toPublicRunView(view, 6).actions).toEqual([]);
		expect(toPublicRunView(view, 8).actions).toEqual([]);
	});

	test("members keep the actions list at every stop", () => {
		expect(toFullRunView(view).actions).toEqual(fullView.actions);
	});

	test("stop 7 keeps only failed rules, stop 8 hides every step", () => {
		expect(toPublicRunView(view, 7).steps.map((s) => s.id)).toEqual([
			failed.id,
		]);
		const verdictOnly = toPublicRunView(view, 8);
		expect(verdictOnly.steps).toEqual([]);
		expect(verdictOnly.stepsHidden).toBe(true);
		expect(verdictOnly.verdict).toBe("block");
	});
});
