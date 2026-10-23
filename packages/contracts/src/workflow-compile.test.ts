import { describe, expect, test } from "bun:test";
import { workflowActionKindSchema } from "./workflow.ts";
import type { Settings, SettingValue } from "./workflow-authoring.ts";
import {
	actionTakesSettings,
	workflowAuthoring,
} from "./workflow-authoring-catalog.ts";
import {
	checkWorkflows,
	compileIssueText,
	compileWorkflowModule,
	compileWorkflows,
	didYouMean,
	type WorkflowFile,
	workflowFileSchema,
} from "./workflow-compile.ts";
import { WORKFLOW_TEMPLATES } from "./workflow-templates.ts";
import { validateWorkflowForEnable } from "./workflow-validate.ts";

const {
	allOf,
	anyOf,
	block,
	check,
	close,
	customCheck,
	humanReview,
	label,
	lock,
	not,
	postComment,
	requestReview,
	schedule,
	trigger,
	workflow,
	workflows,
} = workflowAuthoring;

function compiled(file: WorkflowFile) {
	const result = compileWorkflows(file);
	if (!result.ok) {
		throw new Error(result.issues.map((issue) => issue.message).join("; "));
	}
	return result.definitions;
}

function issues(file: WorkflowFile | SettingValue): string[] {
	const result = compileWorkflowModule({ default: file });
	return result.ok ? [] : result.issues.map((issue) => issue.message);
}

const noNewbs = () => check("account-age", { minDays: 7 });
const rateLimit = () =>
	check("pr-rate-limit", { maxPerWindow: 5, windowHours: 24 });

/** gsimone's two sketch rules, in the code's own ids. */
const GSIMONE = workflows({
	"change-request-opens": workflow({
		on: "change-request.opened",
		check: anyOf(noNewbs().fails, rateLimit().fails),
		pass: [block()],
		fail: [requestReview({ reviewers: ["gsimone"] })],
	}),
	"someone-comments": workflow({
		on: "comment.created",
		check: check("ai-review", { maxSteps: 12 }),
		fail: [block()],
	}),
});

describe("gsimone's sketch", () => {
	test("compiles to the stored shape", () => {
		expect(compiled(GSIMONE)).toEqual([
			{
				id: "change-request-opens",
				name: "change-request-opens",
				version: 1,
				nodes: [
					{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
					{ id: "any-of", type: "gate", mode: "any-of" },
					{
						id: "account-age",
						type: "rule",
						ref: "account-age@1",
						config: { minDays: 7 },
					},
					{
						id: "pr-rate-limit",
						type: "rule",
						ref: "pr-rate-limit@1",
						config: { maxPerWindow: 5, windowHours: 24 },
					},
					{ id: "block", type: "action", action: "block" },
					{
						id: "request-review",
						type: "action",
						action: "request-review",
						params: { reviewers: ["gsimone"] },
					},
				],
				edges: [
					{ id: "trigger-account-age", from: "trigger", to: "account-age" },
					{
						id: "account-age-any-of",
						from: "account-age",
						to: "any-of",
						when: "fail",
					},
					{ id: "trigger-pr-rate-limit", from: "trigger", to: "pr-rate-limit" },
					{
						id: "pr-rate-limit-any-of",
						from: "pr-rate-limit",
						to: "any-of",
						when: "fail",
					},
					{ id: "any-of-block", from: "any-of", to: "block" },
					{
						id: "any-of-request-review",
						from: "any-of",
						to: "request-review",
						when: "fail",
					},
				],
			},
			{
				id: "someone-comments",
				name: "someone-comments",
				version: 1,
				nodes: [
					{ id: "trigger", type: "trigger", kinds: ["comment.created"] },
					{
						id: "ai-review",
						type: "rule",
						ref: "ai-review@2",
						config: { maxSteps: 12 },
					},
					{ id: "block", type: "action", action: "block" },
				],
				edges: [
					{ id: "trigger-ai-review", from: "trigger", to: "ai-review" },
					{
						id: "ai-review-block",
						from: "ai-review",
						to: "block",
						when: "fail",
					},
				],
			},
		]);
	});

	test("both rules can be turned on", () => {
		for (const definition of compiled(GSIMONE)) {
			expect(validateWorkflowForEnable(definition).valid).toBe(true);
		}
	});

	test("an explicit Not gate is the same rule spelled the long way", () => {
		const [definition] = compiled(
			workflows({
				x: workflow({
					on: "change-request.opened",
					check: anyOf(not(noNewbs())),
					pass: [block()],
				}),
			}),
		);
		expect(definition?.nodes.map((node) => node.type)).toEqual([
			"trigger",
			"gate",
			"gate",
			"rule",
			"action",
		]);
		expect(definition && validateWorkflowForEnable(definition).valid).toBe(
			true,
		);
	});
});

describe("automation-shaped graphs", () => {
	test("GitHub Actions: parallel jobs, all must pass, fan-out on failure", () => {
		const lint = check("max-files-changed", { max: 200 });
		const english = check("english-only");
		const crypto = check("crypto-address");
		const all = allOf(lint, english, crypto);
		const result = checkWorkflows(
			workflows({
				ci: workflow({
					name: "pull request checks",
					on: ["change-request.opened", "change-request.updated"],
					check: all,
					pass: [label({ labels: ["ready"] })],
					fail: [block(), postComment({ message: "Checks did not pass." })],
				}),
			}),
		);
		expect(result.ok && result.workflows[0]?.valid).toBe(true);
	});

	test("Cursor automation: a comment runs AI review, a maintainer decides", () => {
		const review = humanReview({
			approve: [label({ labels: ["reviewed"] })],
			deny: [lock({ reason: "spam" }), close()],
		});
		const result = checkWorkflows(
			workflows({
				triage: workflow({
					on: "comment.created",
					check: check("ai-review", { maxSteps: 12 }),
					fail: [review],
				}),
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.workflows[0]?.valid).toBe(true);
	});

	test("Cursor automation: a weekly cron in a named zone reads back with it", () => {
		const weekly = schedule({
			every: { cron: "0 8 * * 0" },
			timezone: "Europe/Berlin",
			match: {
				subjects: ["issue"],
				state: "open",
				inactiveFor: { n: 30, unit: "days" },
			},
		});
		const result = checkWorkflows(
			workflows({
				digest: workflow({
					on: weekly,
					run: [postComment({ message: "Still working on this?" })],
				}),
			}),
		);
		expect(result.ok && result.workflows[0]?.schedules).toEqual([
			{
				nodeId: "schedule",
				summary: "At 08:00 on Sunday (Europe/Berlin)",
				timezone: "Europe/Berlin",
				defaulted: false,
				description:
					"At 08:00 on Sunday (Europe/Berlin), finds open issues with no activity for 30 days, skipping locked ones. Then Tripwire posts your comment.",
			},
		]);
	});

	test("stale issues: every template compiles and can be turned on", () => {
		for (const template of WORKFLOW_TEMPLATES) {
			expect({
				id: template.id,
				valid: validateWorkflowForEnable(template.definition).valid,
			}).toEqual({ id: template.id, valid: true });
		}
	});

	test("stale issues: the auto-close template is exact", () => {
		const stale = WORKFLOW_TEMPLATES.find(
			(template) => template.id === "close-stale-issues",
		);
		expect(stale?.definition.nodes).toEqual([
			{
				id: "warn",
				type: "trigger",
				kinds: ["schedule.matched"],
				schedule: {
					every: { n: 12, unit: "hours" },
					match: {
						subjects: ["issue"],
						state: "open",
						inactiveFor: { n: 15, unit: "days" },
						excludeLabels: ["stale", "no-auto-close"],
						skipLocked: true,
					},
				},
			},
			{
				id: "close",
				type: "trigger",
				kinds: ["schedule.matched"],
				schedule: {
					every: { n: 12, unit: "hours" },
					match: {
						subjects: ["issue"],
						state: "open",
						inactiveFor: { n: 7, unit: "days" },
						labels: ["stale"],
						excludeLabels: ["no-auto-close"],
						skipLocked: true,
					},
				},
			},
			{ id: "reset", type: "trigger", kinds: ["comment.created"] },
			{
				id: "mark-stale",
				type: "action",
				action: "label",
				params: { labels: ["stale"] },
			},
			{
				id: "warn-comment",
				type: "action",
				action: "post-comment",
				params: {
					message:
						"This issue has had no activity for 15 days. It will close in 7 days unless someone comments.",
				},
			},
			{
				id: "close-comment",
				type: "action",
				action: "post-comment",
				params: {
					message:
						"Closing after 22 days with no activity. Reopen it if it still matters.",
				},
			},
			{ id: "close-it", type: "action", action: "close" },
			{
				id: "unmark-stale",
				type: "action",
				action: "remove-label",
				params: { labels: ["stale"] },
			},
		]);
	});

	test("a repo's custom rule is wired by its id", () => {
		const [definition] = compiled(
			workflows({
				x: workflow({
					on: "change-request.opened",
					check: customCheck("custom-no-newbs-01a15e"),
					fail: [block()],
				}),
			}),
		);
		expect(definition?.nodes[1]).toEqual({
			id: "custom-no-newbs-01a15e",
			type: "rule",
			ref: "custom-no-newbs-01a15e@1",
			config: {},
		});
	});

	test("named steps keep their ids and wire anywhere", () => {
		const opened = trigger("change-request.opened");
		const age = check("account-age", { minDays: 30 }).after(opened);
		const files = check("max-files-changed", { max: 50 }).after(age.fails);
		const [definition] = compiled(
			workflows({
				x: workflow({
					steps: {
						opened,
						age,
						files,
						stop: block().after(files.fails),
					},
				}),
			}),
		);
		expect(definition?.edges).toEqual([
			{ id: "opened-age", from: "opened", to: "age" },
			{ id: "age-files", from: "age", to: "files", when: "fail" },
			{ id: "files-stop", from: "files", to: "stop", when: "fail" },
		]);
	});
});

describe("invalid workflows say what is wrong", () => {
	test("a wrong rule id suggests the right one", () => {
		expect(
			issues({
				x: {
					kind: "workflow",
					spec: {
						on: "change-request.opened",
						check: {
							kind: "check",
							rule: "acount-age",
							config: {},
							inputs: [],
						},
					},
				},
			}),
		).toEqual(["acount-age is not a rule. Did you mean account-age?"]);
	});

	test("gsimone's spellings point at the code's ids", () => {
		expect(
			issues({
				x: {
					kind: "workflow",
					spec: {
						on: "change_request.opened",
						check: {
							kind: "check",
							rule: "ai-review",
							config: { maxAnalysisSteps: 12 },
							inputs: [],
						},
						fail: [
							{ kind: "action", action: "request-github-review", inputs: [] },
						],
					},
				},
			}),
		).toEqual([
			"change_request.opened is not an event a workflow can start on. Did you mean change-request.opened?",
			"maxAnalysisSteps is not a setting of ai-review. Did you mean maxSteps?",
			"request-github-review is not an action. Did you mean request-review?",
		]);
	});

	test("bad settings name the field", () => {
		expect(
			issues(
				workflows({
					x: workflow({
						on: "change-request.opened",
						check: check("account-age", { minDays: -1 }),
						fail: [block()],
					}),
				}),
			),
		).toEqual(["account-age: minDays must be 0 or more"]);
	});

	test("a bad schedule names the field once, in product words", () => {
		const scheduled = (settings: Settings) =>
			workflows({
				x: workflow({
					on: schedule(
						// @ts-expect-error
						settings,
					),
					run: [close()],
				}),
			});
		const match = {
			subjects: ["issue"],
			state: "open",
			inactiveFor: { n: 3, unit: "days" },
		};
		const zone = compileWorkflowModule({
			default: scheduled({
				every: { preset: "daily", at: "09:00" },
				timezone: "Europe/Berlinn",
				match,
			}),
		});
		const zero = compileWorkflowModule({
			default: scheduled({
				every: { preset: "daily", at: "09:00" },
				match: { ...match, inactiveFor: { n: 0, unit: "days" } },
			}),
		});
		expect(zone.ok || zone.issues.map(compileIssueText)).toEqual([
			"x > schedule: The timezone is not valid: Europe/Berlinn is not an IANA timezone, like Europe/Berlin.",
		]);
		expect(zero.ok || zero.issues.map(compileIssueText)).toEqual([
			"x > schedule: The inactive time must be 1 or more.",
		]);
		const cron = compileWorkflowModule({
			default: scheduled({ every: { cron: "75 * * * *" }, match }),
		});
		expect(cron.ok || cron.issues.map(compileIssueText)).toEqual([
			"x > schedule: The cron is not valid: minute must be 0 to 59.",
		]);
	});

	test("an issue that already names its step does not name it twice", () => {
		expect(
			compileIssueText({
				workflow: "bad-rule-id",
				step: "crypto-adress",
				message: "crypto-adress is not a rule. Did you mean crypto-address?",
			}),
		).toBe(
			"bad-rule-id > crypto-adress is not a rule. Did you mean crypto-address?",
		);
		expect(
			compileIssueText({
				workflow: "w",
				step: "limit",
				message: "pr-rate-limit: maxPerWindow must be 1 or more",
			}),
		).toBe("w > limit: pr-rate-limit: maxPerWindow must be 1 or more");
		expect(compileIssueText({ workflow: "", message: "bad export" })).toBe(
			"bad export",
		);
	});

	test("a gate with no inputs", () => {
		expect(
			issues(
				workflows({
					x: workflow({
						on: "change-request.opened",
						// @ts-expect-error
						check: anyOf(),
						fail: [block()],
					}),
				}),
			),
		).toEqual(["any-of needs at least one input"]);
	});

	test("a decision wired into a gate is the wrong port type", () => {
		const review = humanReview();
		const result = checkWorkflows(
			workflows({
				x: workflow({
					on: "change-request.opened",
					// @ts-expect-error
					check: anyOf(review.approved),
					pass: [block()],
					steps: { review },
				}),
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.workflows[0]?.valid).toBe(false);
		expect(result.workflows[0]?.issues.map((issue) => issue.message)).toContain(
			"It takes rule results, not decisions.",
		);
	});

	test("a cycle built by hand is refused", () => {
		const inputs: Settings[] = [];
		const first = {
			kind: "check",
			rule: "account-age",
			config: { minDays: 1 },
			inputs,
		};
		const second = {
			kind: "check",
			rule: "crypto-address",
			config: {},
			inputs: [{ kind: "output", step: first, port: "pass" }],
		};
		inputs.push({ kind: "output", step: second, port: "pass" });
		const result = checkWorkflows(
			workflowFileSchema.parse({
				x: {
					kind: "workflow",
					spec: { on: "change-request.opened", steps: { first, second } },
				},
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.workflows[0]?.issues.map((issue) => issue.rule)).toContain(
			"cycle",
		);
	});

	test("pass without a check", () => {
		expect(
			issues(
				workflows({
					// @ts-expect-error
					x: workflow({ on: "comment.created", pass: [block()] }),
				}),
			),
		).toEqual([
			"`pass` and `fail` need a `check`; use `run` for actions with no check",
		]);
	});
});

describe("didYouMean", () => {
	test("finds near ids and refuses far ones", () => {
		expect(didYouMean("maxAnalysisSteps", ["model", "maxSteps"])).toBe(
			"maxSteps",
		);
		expect(didYouMean("acount-age", ["account-age", "ai-review"])).toBe(
			"account-age",
		);
		expect(didYouMean("banana", ["account-age", "ai-review"])).toBeNull();
	});
});

describe("actionTakesSettings", () => {
	test("matches what the panel can edit", () => {
		const editable = workflowActionKindSchema.options.filter((kind) =>
			actionTakesSettings(kind),
		);
		expect(editable).toEqual([
			"label",
			"request-review",
			"webhook",
			"discord",
			"lock",
			"remove-label",
			"post-comment",
		]);
	});
});

describe("review findings", () => {
	test("a trigger cannot stand in for a check", () => {
		const opened = trigger("change-request.opened");
		expect(
			issues(
				workflows({
					x: workflow({
						on: opened,
						// @ts-expect-error
						check: opened,
						fail: [block()],
					}),
				}),
			),
		).toContain(
			"`check` takes a check, a gate or one of their outputs; a trigger or action has no Passes and Doesn't pass",
		);
	});

	test("a review's targets wait for the decision, wherever they are listed", () => {
		const stamp = label({ labels: ["ok"] });
		const review = humanReview({ approve: [stamp] });
		const [definition] = compiled(
			workflows({
				x: workflow({
					on: "change-request.opened",
					check: check("account-age", { minDays: 7 }),
					fail: [review],
					steps: { stamp, review },
				}),
			}),
		);
		expect(definition?.edges.filter((edge) => edge.to === "stamp")).toEqual([
			{ id: "review-stamp", from: "review", to: "stamp", when: "approve" },
		]);
	});

	test("a non-step input is reported, not thrown", () => {
		expect(
			issues({
				x: {
					kind: "workflow",
					spec: {
						on: "change-request.opened",
						check: { kind: "gate", mode: "not", inputs: [null] },
						pass: [],
					},
				},
			}),
		).toContain("an input is not a step or a step output");
	});
});
