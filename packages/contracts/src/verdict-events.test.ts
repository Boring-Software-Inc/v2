import { describe, expect, test } from "bun:test";
import {
	bearsVerdict,
	eventKindSchema,
	normalizedEventSchema,
	VERDICT_EVENT_KINDS,
} from "./index.ts";

describe("bearsVerdict", () => {
	test("holds for exactly the events that carry a change request", () => {
		const carriers: string[] = normalizedEventSchema.options
			.filter((option) => "changeRequest" in option.shape)
			.map((option) => option.shape.kind.value);
		expect<string[]>([...VERDICT_EVENT_KINDS].sort()).toEqual(carriers.sort());
		for (const kind of eventKindSchema.options) {
			expect(bearsVerdict(kind)).toBe(carriers.includes(kind));
		}
	});

	test("a comment and a schedule never give the change request its verdict", () => {
		expect(bearsVerdict("comment.created")).toBe(false);
		expect(bearsVerdict("schedule.matched")).toBe(false);
		expect(bearsVerdict("change-request.updated")).toBe(true);
	});

	test("an unknown or missing kind does not bear a verdict", () => {
		expect(bearsVerdict(null)).toBe(false);
		expect(bearsVerdict(undefined)).toBe(false);
		expect(bearsVerdict("pull_request")).toBe(false);
	});
});
