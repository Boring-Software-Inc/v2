import { describe, expect, test } from "bun:test";
import {
	accessDenialFor,
	applySignupAccessDefaults,
	gateFromFlag,
} from "./access.ts";

// Pure decision logic shared by the signup create hook and the access gate.
describe("waitlist access gate", () => {
	describe("signup defaults", () => {
		test("defaults a new signup to pending", () => {
			expect(
				applySignupAccessDefaults({ email: "a@b.com" }, null).accessStatus,
			).toBe("pending");
		});

		test("ignores client-supplied accessStatus (server-assigned only)", () => {
			const out = applySignupAccessDefaults(
				{ email: "a@b.com", accessStatus: "approved" },
				null,
			);
			expect(out.accessStatus).toBe("pending");
		});

		test("stamps waitlistedAt when provided", () => {
			const t = new Date("2025-01-01T00:00:00Z");
			expect(
				applySignupAccessDefaults({ email: "a@b.com" }, t).waitlistedAt,
			).toBe(t);
		});
	});

	describe("API gate rejection", () => {
		test("denies pending with FORBIDDEN", () => {
			expect(accessDenialFor("pending")?.code).toBe("FORBIDDEN");
		});
		test("denies rejected with FORBIDDEN", () => {
			expect(accessDenialFor("rejected")?.code).toBe("FORBIDDEN");
		});
		test("allows approved", () => {
			expect(accessDenialFor("approved")).toBeNull();
		});
	});

	describe("flag fallback (Databuddy primary, env fallback)", () => {
		test("trusts a resolved flag", () => {
			expect(gateFromFlag({ enabled: true, reason: "RULE_MATCH" }, false)).toBe(
				true,
			);
			expect(gateFromFlag({ enabled: false, reason: "RULE_MATCH" }, true)).toBe(
				false,
			);
		});

		test("falls back to env when unresolved or thrown", () => {
			expect(gateFromFlag({ enabled: false, reason: "NOT_FOUND" }, true)).toBe(
				true,
			);
			expect(gateFromFlag({ enabled: false, reason: "ERROR" }, true)).toBe(
				true,
			);
			expect(
				gateFromFlag({ enabled: false, reason: "SESSION_PENDING" }, true),
			).toBe(true);
			expect(gateFromFlag(null, true)).toBe(true);
			expect(gateFromFlag(null, false)).toBe(false);
		});
	});
});
