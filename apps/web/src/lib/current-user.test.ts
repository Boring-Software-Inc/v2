import { describe, expect, test } from "bun:test";
import type { CurrentUser } from "#/lib/auth.functions";
import { accountIdentity } from "#/lib/current-user";

function currentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
	return {
		id: "user-1",
		name: "Grim",
		login: "grim",
		forgeLogin: null,
		email: null,
		image: "",
		...overrides,
	};
}

describe("accountIdentity", () => {
	test("prefers email over login", () => {
		expect(accountIdentity(currentUser({ email: "grim@example.com" }))).toBe(
			"grim@example.com",
		);
	});

	test("falls back to a distinct login", () => {
		expect(accountIdentity(currentUser())).toBe("@grim");
	});

	test("omits a repeated name and login", () => {
		expect(accountIdentity(currentUser({ login: "Grim" }))).toBeNull();
	});
});
