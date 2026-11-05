import { describe, expect, test } from "bun:test";
import { orgRenamePatch } from "#/components/organizations/org-general-settings-page";

const PREVIOUS = { name: "Original org", slug: "original-org" };

describe("orgRenamePatch", () => {
	test("unchanged values are omitted, not assigned undefined", () => {
		const patch = orgRenamePatch("original-org", PREVIOUS, PREVIOUS);
		expect(patch).toEqual({ org: "original-org" });
		expect(Object.hasOwn(patch, "name")).toBe(false);
		expect(Object.hasOwn(patch, "slug")).toBe(false);
	});

	test("a name-only rename does not patch the slug", () => {
		const patch = orgRenamePatch("original-org", PREVIOUS, {
			...PREVIOUS,
			name: "New org",
		});
		expect(patch).toEqual({ org: "original-org", name: "New org" });
		expect(Object.hasOwn(patch, "slug")).toBe(false);
	});

	test("a slug-only rename keeps the current routing org and omits the name", () => {
		const patch = orgRenamePatch("original-org", PREVIOUS, {
			...PREVIOUS,
			slug: "new-org",
		});
		expect(patch).toEqual({ org: "original-org", slug: "new-org" });
		expect(Object.hasOwn(patch, "name")).toBe(false);
		expect(JSON.stringify(patch)).toBe(
			'{"org":"original-org","slug":"new-org"}',
		);
	});

	test("both changed values are preserved without trimming or coercion", () => {
		expect(
			orgRenamePatch("original-org", PREVIOUS, {
				name: " New org ",
				slug: "new-org",
			}),
		).toEqual({ org: "original-org", name: " New org ", slug: "new-org" });
		expect(PREVIOUS).toEqual({ name: "Original org", slug: "original-org" });
	});
});
