import { describe, expect, test } from "bun:test";
import type { JsonValue } from "@tripwire/contracts";
import { z } from "zod";
import {
	fieldListItems,
	fieldsForSchema,
	nodeFieldValues,
	ruleConfigFieldsSchema,
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

describe("fieldsForSchema", () => {
	test("unwraps nested defaults and optionals without applying defaults to drafts", () => {
		const fields = fieldsForSchema(
			z.object({
				count: z.number().min(1).max(12).int().default(7).optional(),
				text: z.string().optional().default("hello").describe("Message"),
				enabled: z.boolean().default(true),
				mode: z.enum(["one", "two"]).optional(),
				labels: z.array(z.string().default("").optional()).default([]),
				payload: z.object({ nested: z.string() }),
				numbers: z.array(z.number()),
				url: z.string().optional().meta({ secret: true }),
			}),
		);
		expect(fields).toEqual([
			{
				key: "count",
				label: "count",
				secret: false,
				kind: "number",
				min: 1,
				max: 12,
				int: true,
			},
			{ key: "text", label: "Message", secret: false, kind: "string" },
			{ key: "enabled", label: "enabled", secret: false, kind: "boolean" },
			{
				key: "mode",
				label: "mode",
				secret: false,
				kind: "enum",
				options: ["one", "two"],
			},
			{ key: "labels", label: "labels", secret: false, kind: "string-list" },
			{ key: "payload", label: "payload", secret: false, kind: "json" },
			{ key: "numbers", label: "numbers", secret: false, kind: "json" },
			{ key: "url", label: "url", secret: true, kind: "string" },
		]);
	});

	test("keeps explicit check order, exclusive bounds, and safeint flags without implicit bounds", () => {
		expect(
			fieldsForSchema(
				z.object({
					integer: z.number().int(),
					bounded: z.number().min(2).gt(1).max(9).lt(10),
				}),
			),
		).toEqual([
			{
				key: "integer",
				label: "integer",
				secret: false,
				kind: "number",
				min: undefined,
				max: undefined,
				int: true,
			},
			{
				key: "bounded",
				label: "bounded",
				secret: false,
				kind: "number",
				min: 1,
				max: 10,
				int: false,
			},
		]);
	});

	test("retains numeric enum metadata rather than asserting string options", () => {
		expect(
			fieldsForSchema(z.object({ mode: z.enum({ Off: 0, On: 1 }) })),
		).toEqual([
			{
				key: "mode",
				label: "mode",
				secret: false,
				kind: "enum",
				options: [0, 1],
			},
		]);
	});

	test("has no editable shape for a missing or non-object schema", () => {
		expect(fieldsForSchema(undefined)).toBeNull();
		expect(fieldsForSchema(z.string())).toBeNull();
		expect(fieldsForSchema(z.object({}))).toEqual([]);
	});
});

describe("ruleConfigFieldsSchema", () => {
	test("preserves partial invalid objects, extra keys, and array spread semantics", () => {
		const draft = { minDays: "-", extra: { untouched: [false, null] } };
		expect(ruleConfigFieldsSchema.parse(draft)).toEqual(draft);
		expect(ruleConfigFieldsSchema.parse(["draft", { extra: true }])).toEqual({
			0: "draft",
			1: { extra: true },
		});
		expect(ruleConfigFieldsSchema.parse({})).toEqual({});
	});

	test.each([
		null,
		"unfinished",
		false,
		1,
		undefined,
	])("falls back for scalar/null/missing config %p", (config) => {
		expect(ruleConfigFieldsSchema.parse(config)).toEqual({});
	});

	test("rule summaries read invalid drafts without filling catalog defaults", () => {
		const configs: JsonValue[] = [{}, { minDays: "-", extra: true }];
		const values = configs.map((config) =>
			nodeFieldValues({
				id: "r",
				type: "rule",
				ref: "account-age@1",
				config,
			}).map(({ field, value }) => [field.key, value]),
		);
		expect(values).toEqual([[["minDays", undefined]], [["minDays", "-"]]]);
	});
});

describe("draft summary fallbacks", () => {
	test("labels keep valid strings from mixed lists, including empty strings", () => {
		const [row] = nodeFieldValues({
			id: "a",
			type: "action",
			action: "label",
			params: { labels: ["a", 3, null, "", "b"] },
		});
		expect(row?.value).toEqual(["a", "", "b"]);
	});

	test("action text fallbacks preserve whitespace, empties, and malformed values", () => {
		const summaryFor = (
			action: "post-comment" | "lock" | "webhook",
			params: { [key: string]: JsonValue },
		) =>
			nodeFieldValues({ id: "a", type: "action", action, params }).map(
				({ value }) => value,
			);
		expect(summaryFor("post-comment", { message: "  " })).toEqual([undefined]);
		expect(summaryFor("post-comment", { message: " draft " })).toEqual([
			" draft ",
		]);
		expect(summaryFor("post-comment", { message: 4 })).toEqual([undefined]);
		expect(summaryFor("lock", { reason: "" })).toEqual([""]);
		expect(summaryFor("lock", { reason: "off-topic" })).toEqual(["Off-topic"]);
		expect(summaryFor("lock", { reason: false })).toEqual(["None"]);
		expect(summaryFor("webhook", { url: 4 })).toEqual([undefined]);
	});

	test("list and JSON summaries tolerate malformed field values", () => {
		const base = { key: "draft", label: "Draft", secret: false };
		expect(
			summarizeFieldValue({ ...base, kind: "string-list" }, ["a", false, "b"]),
		).toBe("a, b");
		expect(summarizeFieldValue({ ...base, kind: "string-list" }, 4)).toBe(
			"none",
		);
		expect(
			summarizeFieldValue({ ...base, kind: "json" }, { a: 1, b: 2, c: 3 }),
		).toBe("a, b +1");
		expect(summarizeFieldValue({ ...base, kind: "json" }, {})).toBe("empty");
		expect(summarizeFieldValue({ ...base, kind: "json" }, [1, 2])).toBe(
			"2 items",
		);
		expect(summarizeFieldValue({ ...base, kind: "json" }, false)).toBe("false");
		expect(
			summarizeFieldValue(
				{ ...base, secret: true, kind: "string" },
				"sensitive",
			),
		).toBe("••••••••");
	});
});
