import { describe, expect, test } from "bun:test";
import { workflowAuthoring } from "./workflow-authoring-catalog.ts";
import { checkWorkflows } from "./workflow-compile.ts";

const {
	allOf,
	anyOf,
	block,
	check,
	close,
	humanReview,
	label,
	not,
	schedule,
	trigger,
	workflow,
} = workflowAuthoring;

const opened = trigger("change-request.opened");
const age = check("account-age", { minDays: 7 });
const review = humanReview({ approve: [label({ labels: ["ok"] })] });

describe("tripwire.ts types reject wiring the runtime rejects", () => {
	test("a gate takes only checks, gates and their results", () => {
		// @ts-expect-error
		allOf(opened);
		// @ts-expect-error
		allOf(review.approved);
		// @ts-expect-error
		not(review.denied);
		// @ts-expect-error
		allOf(block());
		// @ts-expect-error
		anyOf(review);
		expect(allOf(age, age.fails).inputs).toHaveLength(2);
		expect(not(age.fails).inputs).toHaveLength(1);
	});

	test("all of and any of take at least one input", () => {
		// @ts-expect-error
		allOf();
		// @ts-expect-error
		anyOf();
		expect(anyOf(age).inputs).toHaveLength(1);
	});

	test("not takes exactly one input", () => {
		// @ts-expect-error
		not(age, age.fails);
		// @ts-expect-error
		not();
	});

	test("check takes a check, a gate or one of their results", () => {
		// @ts-expect-error
		workflow({ on: "change-request.opened", check: review, pass: [block()] });
		// @ts-expect-error
		workflow({ on: "change-request.opened", check: opened, pass: [block()] });
		// @ts-expect-error
		workflow({ on: "change-request.opened", pass: [block()] });
		// @ts-expect-error
		workflow({ on: "change-request.opened", fail: [block()] });
		expect(
			workflow({
				on: "change-request.opened",
				check: age.fails,
				pass: [block()],
			}).kind,
		).toBe("workflow");
	});

	test("wrong ids and settings fail with the right one named", () => {
		// @ts-expect-error
		check("acount-age", { minDays: 7 });
		// @ts-expect-error
		check("account-age", { minDayz: 7 });
		// @ts-expect-error
		check("account-age", { minDays: "7" });
	});
});

describe("tripwire.ts values the types cannot express are rejected on check", () => {
	test("an empty label list, a missing rule version, a fast cron, a bad zone", () => {
		const rejected = checkWorkflows({
			emptyLabel: workflow({
				on: "change-request.opened",
				check: age,
				fail: [label({ labels: [] })],
			}),
		});
		expect(rejected.ok).toBe(false);
		const pinned = checkWorkflows({
			pinned: workflow({
				on: "change-request.opened",
				check: check("account-age", { minDays: 7 }, { version: 99 }),
				fail: [block()],
			}),
		});
		expect(pinned.ok && pinned.workflows[0]?.valid).toBe(false);
		const triggers = [
			schedule({
				every: { cron: "*/1 * * * *" },
				match: {
					subjects: ["issue"],
					state: "open",
					inactiveFor: { n: 1, unit: "days" },
				},
			}),
			schedule({
				every: { cron: "0 9 * * *" },
				timezone: "Mars/Olympus",
				match: {
					subjects: ["issue"],
					state: "open",
					inactiveFor: { n: 1, unit: "days" },
				},
			}),
		];
		for (const on of triggers) {
			expect(
				checkWorkflows({ timed: workflow({ on, run: [close()] }) }).ok,
			).toBe(false);
		}
	});
});
