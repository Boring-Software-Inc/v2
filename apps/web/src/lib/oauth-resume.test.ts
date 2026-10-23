import { describe, expect, test } from "bun:test";
import { oauthAuthorizeResume } from "./oauth-resume.ts";

describe("oauthAuthorizeResume", () => {
	test("rebuilds the authorize request without the signing params", () => {
		const resume = oauthAuthorizeResume({
			response_type: "code",
			client_id: "abc",
			scope: "openid tripwire:read",
			state: 123,
			exp: 1792730190,
			ba_iat: 1792729590615,
			ba_param: "scope",
			sig: "x1e",
		});
		expect(resume).toBe(
			"/api/auth/oauth2/authorize?response_type=code&client_id=abc&scope=openid+tripwire%3Aread&state=123",
		);
	});

	test("ignores a plain login visit", () => {
		expect(oauthAuthorizeResume({ redirect: "/acme/home" })).toBeNull();
	});
});
