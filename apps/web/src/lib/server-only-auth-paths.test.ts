import { describe, expect, test } from "bun:test";
import { isServerOnlyAuthPath } from "./server-only-auth-paths.ts";

describe("server-only auth paths", () => {
	test("impersonation endpoints are not reachable over http", () => {
		expect(isServerOnlyAuthPath("/api/auth/staff/impersonate-user")).toBe(true);
		expect(isServerOnlyAuthPath("/api/auth/admin/impersonate-user")).toBe(true);
		expect(isServerOnlyAuthPath("/api/auth/admin/stop-impersonating")).toBe(
			true,
		);
		expect(isServerOnlyAuthPath("/API/AUTH/Staff/impersonate-user")).toBe(true);
	});

	test("ordinary auth paths stay open", () => {
		expect(isServerOnlyAuthPath("/api/auth/get-session")).toBe(false);
		expect(isServerOnlyAuthPath("/api/auth/sign-out")).toBe(false);
		expect(isServerOnlyAuthPath("/api/auth/callback/github")).toBe(false);
	});
});
