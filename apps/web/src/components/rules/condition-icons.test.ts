import { describe, expect, test } from "bun:test";
import { CUSTOM_SIGNALS } from "@tripwire/contracts";
import {
	CONDITION_GROUP_ICON,
	CONDITION_ICON,
} from "#/components/rules/condition-icons";

describe("condition icons", () => {
	test("every condition has its own icon", () => {
		const missing = CUSTOM_SIGNALS.filter((s) => !CONDITION_ICON[s.id]).map(
			(s) => s.id,
		);
		expect(missing).toEqual([]);
	});

	test("no two conditions share an icon", () => {
		const icons = CUSTOM_SIGNALS.map((s) => CONDITION_ICON[s.id]);
		expect(new Set(icons).size).toBe(icons.length);
	});

	test("no condition reuses its area's icon", () => {
		const clashes = CUSTOM_SIGNALS.filter(
			(s) => CONDITION_ICON[s.id] === CONDITION_GROUP_ICON[s.group],
		).map((s) => s.id);
		expect(clashes).toEqual([]);
	});

	test("the map holds no stale ids", () => {
		const known = new Set(CUSTOM_SIGNALS.map((s) => s.id));
		expect(Object.keys(CONDITION_ICON).filter((id) => !known.has(id))).toEqual(
			[],
		);
	});
});
