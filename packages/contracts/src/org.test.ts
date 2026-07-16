import { describe, expect, test } from "bun:test";
import {
	orgSlugSchema,
	RESERVED_ORG_SLUGS,
	slugifyOrgName,
	suffixSlug,
} from "./org.ts";

describe("orgSlugSchema (§9)", () => {
	test.each([
		"acme",
		"boring-software",
		"a1b",
		"x".repeat(32),
	])("accepts %s", (slug) => {
		expect(orgSlugSchema.safeParse(slug).success).toBe(true);
	});

	test.each([
		["ab", "too short"],
		["x".repeat(33), "too long"],
		["-acme", "leading hyphen"],
		["acme-", "trailing hyphen"],
		["Acme", "uppercase"],
		["ac me", "whitespace"],
		["acmé", "diacritic"],
		["acme_inc", "underscore"],
		["", "empty"],
	])("rejects %s (%s)", (slug) => {
		expect(orgSlugSchema.safeParse(slug).success).toBe(false);
	});

	test("rejects every reserved slug", () => {
		for (const reserved of RESERVED_ORG_SLUGS) {
			expect(orgSlugSchema.safeParse(reserved).success).toBe(false);
		}
	});

	test("reserved list covers every current top-level route", () => {
		// Mirror of apps/web/src/routes at the time of writing — a new top-level
		// route MUST be added to RESERVED_ORG_SLUGS (this test is the reminder).
		for (const route of [
			"activity",
			"analytics",
			"invite",
			"login",
			"moderation",
			"onboarding",
			"oauth",
			"queue",
			"rules",
			"runs",
			"workflows",
			"dev",
			"api",
		]) {
			expect(RESERVED_ORG_SLUGS.has(route)).toBe(true);
		}
	});
});

describe("slugifyOrgName", () => {
	test.each([
		["Boring Software", "boring-software"],
		["  Acme,  Inc.  ", "acme-inc"],
		["Grüße GmbH", "gruße-gmbh".replace("ß", "-") /* ß is non-alnum */],
		["ab", "ab0"], // padded to the 3-char floor
		["X".repeat(64), "x".repeat(32)],
	])("%s → %s", (input, expected) => {
		expect(slugifyOrgName(input)).toBe(expected);
	});

	test("output (or its suffixed form) always validates when non-reserved", () => {
		for (const name of ["Grim", "A B", "--weird--", "The 3rd Org!"]) {
			const slug = slugifyOrgName(name);
			const ok =
				orgSlugSchema.safeParse(slug).success ||
				orgSlugSchema.safeParse(suffixSlug(slug, 2)).success;
			expect(ok).toBe(true);
		}
	});
});

describe("suffixSlug", () => {
	test("appends within the 32-char cap", () => {
		expect(suffixSlug("acme", 2)).toBe("acme-2");
		const long = "x".repeat(32);
		const suffixed = suffixSlug(long, 12);
		expect(suffixed.length).toBeLessThanOrEqual(32);
		expect(suffixed.endsWith("-12")).toBe(true);
	});
});
