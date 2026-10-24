import { describe, expect, test } from "bun:test";
import {
	ADMIN_ORG_KINDS,
	ADMIN_REPO_STATUSES,
	ADMIN_USER_STATUSES,
	adminOrgsSearchSchema,
	adminReposSearchSchema,
	adminUsersSearchSchema,
} from "./admin-search";

describe("adminUsersSearchSchema", () => {
	test("defaults to all users and no online filter", () => {
		expect(adminUsersSearchSchema.parse({})).toEqual({ status: "all" });
	});

	test("falls back on bad values", () => {
		expect(
			adminUsersSearchSchema.parse({ status: "banned", online: "yes" }),
		).toEqual({ status: "all", online: undefined });
	});

	test("round trips every status with the online filter", () => {
		for (const status of ADMIN_USER_STATUSES) {
			expect(adminUsersSearchSchema.parse({ status, online: true })).toEqual({
				status,
				online: true,
			});
		}
	});
});

describe("adminUsersSearchSchema user", () => {
	test("keeps the open user id", () => {
		expect(adminUsersSearchSchema.parse({ user: "u1" })).toEqual({
			status: "all",
			user: "u1",
		});
	});

	test("drops a bad user id", () => {
		expect(adminUsersSearchSchema.parse({ user: "" })).toEqual({
			status: "all",
			user: undefined,
		});
	});
});

describe("adminReposSearchSchema", () => {
	test("defaults to all repos", () => {
		expect(adminReposSearchSchema.parse({})).toEqual({ status: "all" });
	});

	test("falls back on a bad status", () => {
		expect(adminReposSearchSchema.parse({ status: "armed" })).toEqual({
			status: "all",
		});
	});

	test("round trips every status", () => {
		for (const status of ADMIN_REPO_STATUSES) {
			expect(adminReposSearchSchema.parse({ status })).toEqual({ status });
		}
	});
});

describe("adminOrgsSearchSchema", () => {
	test("defaults to all orgs", () => {
		expect(adminOrgsSearchSchema.parse({})).toEqual({ kind: "all" });
	});

	test("falls back on a bad kind", () => {
		expect(adminOrgsSearchSchema.parse({ kind: "enterprise" })).toEqual({
			kind: "all",
		});
	});

	test("round trips every kind", () => {
		for (const kind of ADMIN_ORG_KINDS) {
			expect(adminOrgsSearchSchema.parse({ kind })).toEqual({ kind });
		}
	});
});
