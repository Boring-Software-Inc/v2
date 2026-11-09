import { describe, expect, test } from "bun:test";
import { type JsonValue, TRIPWIRE_RULE_FIELD } from "@tripwire/contracts";
import {
	getDatabuddyUserOverride,
	updateDatabuddyUserOverrides,
} from "./databuddy-overrides.ts";

const on: JsonValue = {
	type: "user_id",
	operator: "in",
	values: ["mara", "lee"],
	enabled: true,
	batch: false,
	field: TRIPWIRE_RULE_FIELD.on,
	label: "Retain this metadata",
};
const email: JsonValue = {
	type: "email",
	operator: "ends_with",
	value: "@example.com",
	enabled: true,
	batch: false,
};

describe("getDatabuddyUserOverride", () => {
	test("reads both manual and Tripwire user rules, not cached local choices", () => {
		expect(getDatabuddyUserOverride([on], "mara")).toBe("on");
		expect(
			getDatabuddyUserOverride(
				[
					{
						type: "user_id",
						operator: "equals",
						value: "mara",
						enabled: false,
						batch: false,
					},
				],
				"mara",
			),
		).toBe("off");
		expect(getDatabuddyUserOverride([on], "absent")).toBe("default");
	});
	test("an externally edited rule's value wins over its old ownership marker", () => {
		expect(
			getDatabuddyUserOverride(
				[
					{
						type: "user_id",
						operator: "in",
						field: TRIPWIRE_RULE_FIELD.off,
						values: ["mara"],
						enabled: true,
						batch: false,
					},
				],
				"mara",
			),
		).toBe("on");
	});
	test("reads batch user IDs and follows explicit rule order", () => {
		const off = {
			type: "user_id",
			operator: "equals",
			batch: true,
			batchValues: ["mara", "jo"],
			enabled: false,
		};
		expect(getDatabuddyUserOverride([off, on], "mara")).toBe("off");
		expect(getDatabuddyUserOverride([on, off], "mara")).toBe("on");
	});
	test("does not confuse broad targeting, malformed rules, or unknown rules with an explicit override", () => {
		const rules: JsonValue[] = [
			null,
			"unknown",
			email,
			{
				type: "user_id",
				operator: "not_in",
				values: ["other"],
				enabled: true,
				batch: false,
			},
			{
				type: "user_id",
				operator: "in",
				values: ["mara"],
				enabled: "true",
				batch: false,
			},
		];
		expect(getDatabuddyUserOverride(rules, "mara")).toBe("default");
	});
});

describe("updateDatabuddyUserOverrides", () => {
	test("preserves every other user and metadata when changing one membership", () => {
		const rules: JsonValue[] = [email, on];
		const before = structuredClone(rules);
		const updated = updateDatabuddyUserOverrides(rules, [
			{ userId: "mara", choice: "off" },
		]);
		expect(getDatabuddyUserOverride(updated, "mara")).toBe("off");
		expect(getDatabuddyUserOverride(updated, "lee")).toBe("on");
		expect(updated).toContainEqual(email);
		expect(updated).toContainEqual({
			type: "user_id",
			operator: "in",
			values: ["lee"],
			enabled: true,
			batch: false,
			field: TRIPWIRE_RULE_FIELD.on,
			label: "Retain this metadata",
		});
		expect(rules).toEqual(before);
	});
	test("Default removes only the target user's explicit memberships, including manual ones", () => {
		const batch = {
			type: "user_id",
			operator: "equals",
			batch: true,
			batchValues: ["mara", "jo"],
			enabled: false,
		};
		const scalar = {
			type: "user_id",
			operator: "equals",
			value: "mara",
			batch: false,
			enabled: true,
		};
		const updated = updateDatabuddyUserOverrides(
			[on, batch, scalar, email],
			[{ userId: "mara", choice: "default" }],
		);
		expect(getDatabuddyUserOverride(updated, "mara")).toBe("default");
		expect(getDatabuddyUserOverride(updated, "lee")).toBe("on");
		expect(getDatabuddyUserOverride(updated, "jo")).toBe("off");
		expect(updated).toHaveLength(3);
		expect(updated).toContainEqual({ ...batch, batchValues: ["jo"] });
		expect(updated).toContainEqual(email);
	});
	test("retains unrelated and unsupported rules byte-for-byte", () => {
		const unknown: JsonValue = { future: { targeting: ["mara"] } };
		const broad: JsonValue = {
			type: "user_id",
			operator: "starts_with",
			value: "m",
			enabled: false,
			batch: false,
		};
		const updated = updateDatabuddyUserOverrides(
			[unknown, broad, email],
			[{ userId: "mara", choice: "on" }],
		);
		expect(updated.slice(1)).toEqual([unknown, broad, email]);
	});
	test("is idempotent and does not accumulate user rules across repeated changes", () => {
		const first = updateDatabuddyUserOverrides(
			[on, email],
			[{ userId: "mara", choice: "off" }],
		);
		expect(
			updateDatabuddyUserOverrides(first, [{ userId: "mara", choice: "off" }]),
		).toEqual(first);
		expect(updateDatabuddyUserOverrides([on, email], [])).toEqual([on, email]);
	});
});
