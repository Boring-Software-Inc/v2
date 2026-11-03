import { describe, expect, test } from "bun:test";
import { Route as LoginRoute } from "#/routes/login";
import { Route as PopupRoute } from "#/routes/oauth.popup-callback";
import { Route as WaitlistRoute } from "#/routes/oauth.waitlist";

const validateLogin = LoginRoute.options.validateSearch;
const validatePopup = PopupRoute.options.validateSearch;
const validateWaitlist = WaitlistRoute.options.validateSearch;
if (
	!(
		validateLogin instanceof Function &&
		validatePopup instanceof Function &&
		validateWaitlist instanceof Function
	)
) {
	throw new Error("OAuth routes must use callable search validators");
}

const anonId = "anon_12345678-1234-1234-1234-123456789abc";
const sessionId = "sess_12345678-1234-1234-1234-123456789abc";

describe("login route search", () => {
	test("retains same-site paths and validated tracking", () => {
		expect(
			validateLogin({
				redirect: "/org/home?x=%2F",
				anonId,
				sessionId,
			}),
		).toEqual({ redirect: "/org/home?x=%2F", anonId, sessionId });
	});

	for (const redirect of [
		undefined,
		null,
		17,
		false,
		[],
		{},
		"",
		" ",
		"https://external.example",
		"//external.example",
	]) {
		test(`does not add redirect for ${JSON.stringify(redirect)}`, () => {
			const result = validateLogin({ redirect });
			expect(result).toEqual({});
			expect(Object.hasOwn(result ?? {}, "redirect")).toBe(false);
		});
	}

	test("signed OAuth resume wins over redirect without changing parameter filtering", () => {
		expect(
			validateLogin({
				client_id: "client",
				response_type: "code",
				sig: "signature",
				exp: "123",
				ba_iat: "456",
				scope: "openid tripwire:read",
				redirect: "/ignored",
			}),
		).toEqual({
			redirect:
				"/api/auth/oauth2/authorize?client_id=client&response_type=code&scope=openid+tripwire%3Aread&redirect=%2Fignored",
		});
	});
});

describe("waitlist popup route search", () => {
	test("preserves string fields and only valid tracking values", () => {
		expect(
			validateWaitlist({
				opener: "https://landing.example",
				mode: "popup",
				anonId,
				sessionId,
			}),
		).toEqual({
			opener: "https://landing.example",
			mode: "popup",
			anonId,
			sessionId,
		});
		expect(
			validatePopup({
				opener: "",
				mode: " popup ",
				error: " ",
				anonId: "invalid",
			}),
		).toEqual({ opener: "", mode: " popup ", error: " " });
	});

	test("retains explicit undefined field keys for malformed input", () => {
		const waitlist = validateWaitlist({
			opener: 42,
			mode: [],
		});
		const popup = validatePopup({
			opener: null,
			mode: {},
			error: false,
		});
		expect(waitlist).toEqual({ opener: undefined, mode: undefined });
		expect(popup).toEqual({
			opener: undefined,
			mode: undefined,
			error: undefined,
		});
		expect(Object.keys(waitlist ?? {})).toEqual(["opener", "mode"]);
		expect(Object.keys(popup ?? {})).toEqual(["opener", "error", "mode"]);
	});
});
