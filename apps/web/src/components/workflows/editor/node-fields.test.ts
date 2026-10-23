import { describe, expect, test } from "bun:test";
import {
	fieldListItems,
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";

function summary(params: Parameters<typeof reviewNode>[0]) {
	return nodeFieldValues(reviewNode(params)).map(
		({ field, value }) =>
			`${field.label}: ${summarizeFieldValue(field, value)}`,
	);
}

function reviewNode(params?: {
	reviewers?: (string | { id: number; login: string })[];
	teamReviewers?: string[];
}) {
	return {
		id: "a",
		type: "action" as const,
		action: "request-review" as const,
		params,
	};
}

describe("nodeFieldValues — request-review", () => {
	test("shows the people and teams it asks", () => {
		expect(
			summary({
				reviewers: [{ id: 1, login: "octocat" }, "hubot"],
				teamReviewers: ["core"],
			}),
		).toEqual(["Reviewers: octocat, hubot", "Teams: core"]);
	});

	test("an action with no targets says so", () => {
		expect(summary(undefined)).toEqual(["Reviewers: Not set"]);
	});
});

describe("label rows keep each label whole", () => {
	test("schedule label filters are lists, one item per label", () => {
		const rows = nodeFieldValues({
			id: "t",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: { n: 12, unit: "hours" },
				match: {
					labels: ["stale"],
					excludeLabels: ["stale", "no-auto-close"],
				},
			},
		});
		const lists = rows.flatMap(({ field, value }) => {
			const items = fieldListItems(field, value);
			return items ? [[field.key, items]] : [];
		});
		expect(lists).toEqual([
			["labels", ["stale"]],
			["excludeLabels", ["stale", "no-auto-close"]],
		]);
	});

	test("a label step lists its labels once each", () => {
		const [row] = nodeFieldValues({
			id: "l",
			type: "action",
			action: "label",
			params: { labels: ["no-auto-close", "needs-triage", "no-auto-close"] },
		});
		expect(row && fieldListItems(row.field, row.value)).toEqual([
			"no-auto-close",
			"needs-triage",
		]);
	});
});
