import { describe, expect, test } from "bun:test";
import { resolveAuthPosture } from "./server.ts";

describe("resolveAuthPosture — fail-closed in production", () => {
	test("secret present ⇒ enabled anywhere", () => {
		expect(resolveAuthPosture({ secret: "s", nodeEnv: "production" })).toBe(
			"enabled",
		);
		expect(resolveAuthPosture({ secret: "s", nodeEnv: undefined })).toBe(
			"enabled",
		);
	});

	test("no secret in dev ⇒ open-dev (gate stands open, logged)", () => {
		expect(
			resolveAuthPosture({ secret: undefined, nodeEnv: "development" }),
		).toBe("open-dev");
		expect(resolveAuthPosture({ secret: undefined, nodeEnv: undefined })).toBe(
			"open-dev",
		);
	});

	test("no secret in production ⇒ REFUSES to serve", () => {
		expect(() =>
			resolveAuthPosture({ secret: undefined, nodeEnv: "production" }),
		).toThrow("refusing to serve");
	});
});
