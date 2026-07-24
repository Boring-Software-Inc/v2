import { describe, expect, test } from "bun:test";
import { isRedirect } from "@tanstack/react-router";
import { assertSession } from "#/lib/server/session";

/**
 * §10 — mutating controls (approve/deny) and list-shaped server functions
 * redirect to /login without a session; open-dev posture keeps the gate open.
 * The gate throws `redirect()` (serializable across the RPC boundary), never a
 * raw `Response` (Seroval can't serialize it — it crashes SSR route loads).
 */
describe("assertSession", () => {
	test("auth enabled + no session ⇒ redirects to /login", () => {
		try {
			assertSession({ authEnabled: true, userId: null });
			throw new Error("expected a redirect");
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			expect((error as { options?: { to?: string } }).options?.to).toBe(
				"/login",
			);
		}
	});

	test("session ⇒ passes", () => {
		expect(() =>
			assertSession({ authEnabled: true, userId: "user-1" }),
		).not.toThrow();
	});

	test("open-dev posture (auth disabled) ⇒ passes", () => {
		expect(() =>
			assertSession({ authEnabled: false, userId: null }),
		).not.toThrow();
	});
});
