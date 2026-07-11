import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineRule } from "./define.ts";
import { getRule, listRules } from "./registry.ts";

describe("registry", () => {
	test("all 9 launch rules are registered at @1", () => {
		const refs = listRules().map((r) => r.ref);
		expect(refs.sort()).toEqual(
			[
				"account-age@1",
				"ai-review@1",
				"crypto-address@1",
				"english-only@1",
				"honeypot@1",
				"max-files-changed@1",
				"min-merged-prs@1",
				"pr-rate-limit@1",
				"profile-readme@1",
			].sort(),
		);
	});

	test("lookup is by id@version; unknown refs are null", () => {
		expect(getRule("account-age@1")?.id).toBe("account-age");
		expect(getRule("account-age@99")).toBeNull();
		expect(getRule("account-age")).toBeNull();
	});

	test("defineRule rejects non-kebab ids and bad versions", () => {
		const schemas = { configSchema: z.object({}), resultSchema: z.object({}) };
		const evaluate = () => ({ status: "skipped" as const, reason: "x" });
		expect(() =>
			defineRule({ id: "CamelCase", version: 1, ...schemas, evaluate }),
		).toThrow();
		expect(() =>
			defineRule({ id: "ok-rule", version: 0, ...schemas, evaluate }),
		).toThrow();
	});
});
