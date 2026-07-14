import { describe, expect, test } from "bun:test";
import {
	forcedReadFailures,
	readsInjectionRefusedInProd,
} from "./reads-injection.ts";

describe("forcedReadFailures", () => {
	test("a comma list names the reads to force-fail (dev)", () => {
		expect([
			...forcedReadFailures({ TRIPWIRE_FAIL_READS: "diff,contributor" }),
		]).toEqual(["diff", "contributor"]);
	});

	test("the `all` shorthand fails every injectable read", () => {
		expect([...forcedReadFailures({ TRIPWIRE_FAIL_READS: "all" })]).toEqual([
			"diff",
			"commits",
			"contributor",
		]);
	});

	test("refused in production — the worker never self-degrades on a flag", () => {
		expect(
			forcedReadFailures({ TRIPWIRE_FAIL_READS: "all", NODE_ENV: "production" })
				.size,
		).toBe(0);
	});

	test("unset ⇒ no forced failures", () => {
		expect(forcedReadFailures({}).size).toBe(0);
	});

	test("whitespace and empties are ignored", () => {
		expect([
			...forcedReadFailures({ TRIPWIRE_FAIL_READS: " diff , , commits " }),
		]).toEqual(["diff", "commits"]);
	});
});

describe("readsInjectionRefusedInProd", () => {
	test("true only when the flag is set AND production", () => {
		expect(
			readsInjectionRefusedInProd({
				TRIPWIRE_FAIL_READS: "all",
				NODE_ENV: "production",
			}),
		).toBe(true);
		expect(readsInjectionRefusedInProd({ TRIPWIRE_FAIL_READS: "all" })).toBe(
			false,
		);
		expect(readsInjectionRefusedInProd({ NODE_ENV: "production" })).toBe(false);
	});
});
