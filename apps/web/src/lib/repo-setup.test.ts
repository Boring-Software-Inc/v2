import { describe, expect, test } from "bun:test";
import type { RepoAgentRun, RepoSetupFacts } from "@tripwire/db";
import {
	agentActivity,
	formatStepTime,
	nextLabel,
	rulesSummary,
	setupProgress,
	showsReviewQueue,
	stepCompletedAt,
} from "#/lib/repo-setup";

const NOTHING: RepoSetupFacts = {
	installed: false,
	armed: false,
	enabledRuleIds: [],
	customRulesOn: 0,
	workflowsOn: 0,
	firstCheck: null,
	nextChangeRequest: null,
	responsesChosen: false,
};

const SPAM = ["account-age", "english-only", "pr-rate-limit"];

describe("setupProgress", () => {
	test("a fresh repo starts at the install step", () => {
		const progress = setupProgress(NOTHING);
		expect(progress.done).toBe(0);
		expect(progress.total).toBe(4);
		expect(progress.current?.key).toBe("install");
		expect(progress.steps.map((step) => step.title)).toEqual([
			"Install the GitHub App",
			"Turn on rules",
			"See a first check",
			"Pick what Tripwire posts",
		]);
		expect(nextLabel(progress)).toBe("Next: install the GitHub App");
	});

	test("two steps done names the rules that are on and points at the check", () => {
		const progress = setupProgress({
			...NOTHING,
			installed: true,
			armed: true,
			enabledRuleIds: SPAM,
			nextChangeRequest: 512,
		});
		expect(progress.done).toBe(2);
		expect(progress.steps[0]).toMatchObject({
			title: "GitHub App installed",
			done: true,
		});
		expect(progress.steps[1]).toMatchObject({
			title: "Rules on",
			detail: "Spam protection",
		});
		expect(progress.current?.key).toBe("check");
		expect(nextLabel(progress)).toBe("Next: see a first check");
		expect(progress.complete).toBe(false);
	});

	test("rules saved on an unarmed repo do not count as on", () => {
		const progress = setupProgress({
			...NOTHING,
			installed: true,
			enabledRuleIds: SPAM,
		});
		expect(progress.steps[1]?.done).toBe(false);
		expect(progress.current?.key).toBe("rules");
	});

	test("every step done completes setup", () => {
		const progress = setupProgress({
			...NOTHING,
			installed: true,
			armed: true,
			customRulesOn: 1,
			firstCheck: { number: 509, at: "2026-10-20T10:00:00.000Z" },
			responsesChosen: true,
		});
		expect(progress.complete).toBe(true);
		expect(progress.current).toBeNull();
		expect(progress.steps[2]?.title).toBe("First check on #509");
		expect(nextLabel(progress)).toBeNull();
	});
});

describe("showsReviewQueue", () => {
	test("a new repo with nothing waiting shows only the checklist", () => {
		expect(showsReviewQueue(NOTHING, setupProgress(NOTHING), 0)).toBe(false);
	});

	test("a change request waiting for review keeps the queue", () => {
		expect(showsReviewQueue(NOTHING, setupProgress(NOTHING), 1)).toBe(true);
	});

	test("a repo that already ran checks keeps its queue while a step is open", () => {
		const facts: RepoSetupFacts = {
			...NOTHING,
			installed: true,
			armed: true,
			enabledRuleIds: SPAM,
			firstCheck: { number: 509, at: "2026-10-20T10:00:00.000Z" },
		};
		const progress = setupProgress(facts);
		expect(progress.complete).toBe(false);
		expect(showsReviewQueue(facts, progress, 0)).toBe(true);
	});
});

describe("rulesSummary", () => {
	test("shortens a long list", () => {
		expect(
			rulesSummary({
				...NOTHING,
				enabledRuleIds: ["account-age", "honeypot", "max-files-changed"],
				customRulesOn: 2,
			}),
		).toBe("Bulk changes, Account age and 2 more");
	});
});

describe("agent progress", () => {
	const run: RepoAgentRun = {
		code: "AbCdE12345",
		agentName: "Claude Code",
		startedAt: "2026-10-25T21:13:00.000Z",
		lastReportAt: "2026-10-25T21:16:00.000Z",
		stages: {
			install_app: {
				status: "completed",
				detail: null,
				updatedAt: "2026-10-25T21:14:00.000Z",
			},
			turn_on_gate: {
				status: "completed",
				detail: null,
				updatedAt: "2026-10-25T21:15:00.000Z",
			},
			verify_check: {
				status: "active",
				detail: "Running rules on #512",
				updatedAt: "2026-10-25T21:16:00.000Z",
				repo: "lumenhq/lumen",
			},
		},
	};

	test("the latest active stage is what the agent is doing", () => {
		expect(agentActivity(run)).toEqual({
			line: "Running rules on #512",
			step: "check",
		});
		expect(
			agentActivity({
				...run,
				stages: { install_app: run.stages.install_app },
			}),
		).toBeNull();
	});

	test("steps take the time the agent finished them", () => {
		expect(stepCompletedAt(run.stages, "install")).toBe(
			"2026-10-25T21:14:00.000Z",
		);
		expect(stepCompletedAt(run.stages, "rules")).toBe(
			"2026-10-25T21:15:00.000Z",
		);
		expect(stepCompletedAt(run.stages, "check")).toBeNull();
		expect(stepCompletedAt(run.stages, "responses")).toBeNull();
		expect(formatStepTime("2026-10-25T21:14:00.000Z", "UTC")).toBe("9:14 pm");
	});
});
