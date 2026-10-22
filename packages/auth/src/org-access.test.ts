import { describe, expect, test } from "bun:test";
import {
	ORG_PERMISSIONS,
	permissionsForRole,
	roleHasPermission,
} from "./org-access.ts";

describe("org permission matrix", () => {
	test("the product permissions", () => {
		expect(ORG_PERMISSIONS).toEqual([
			"repoResponse:update",
			"orgResponseDefaults:update",
		]);
	});

	test("admins hold every product permission", () => {
		expect(permissionsForRole("admin")).toEqual(ORG_PERMISSIONS);
	});

	test("members hold none", () => {
		expect(permissionsForRole("member")).toEqual([]);
		expect(roleHasPermission("member", "repoResponse:update")).toBe(false);
	});

	test("an unknown role holds none", () => {
		expect(permissionsForRole("owner")).toEqual([]);
		expect(permissionsForRole("")).toEqual([]);
	});

	test("a multi-role string unions its roles", () => {
		expect(permissionsForRole("member, admin")).toEqual(ORG_PERMISSIONS);
	});
});
