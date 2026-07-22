import { describe, expect, test } from "bun:test";
import { atMost, matches, under } from "./comparison.ts";
import { accountAge } from "./registry.ts";
import {
	gappedRule,
	gappedSignals,
	rule,
	signals,
} from "./test-fixtures/config.ts";
import type { WindowSpec } from "./window.ts";

describe("forge narrowing", () => {
	test("the surface holds exactly the forge's producers", () => {
		expect(Object.keys(signals.contributor).sort()).toEqual([
			"accountAge",
			"profileText",
			"recentChangeRequestTimes",
		]);
		expect(Object.keys(signals.pr)).toEqual(["filesChanged"]);
		expect(Object.keys(gappedSignals.contributor)).toEqual(["profileText"]);
		expect(Object.keys(gappedSignals.pr)).toEqual([]);
	});

	test("an unsupported signal is absent from the gapped surface", () => {
		// @ts-expect-error the gapped forge has no accountAge producer
		expect(gappedSignals.contributor.accountAge).toBeUndefined();
	});
});

describe("rule authoring", () => {
	test("rule output is pure keyless data", () => {
		const oldEnough = rule("account age", {
			when: signals.contributor.accountAge,
			comparison: under(7),
			severity: "medium",
		});
		expect(oldEnough).toEqual({
			name: "account age",
			signal: { id: "contributor.accountAge" },
			comparison: { kind: "under", args: [7] },
			severity: "medium",
		});
	});

	test("a windowed count rule carries the transform in its data", () => {
		const rateLimit = rule("pr rate limit", {
			when: signals.contributor.recentChangeRequestTimes.last("24h").count,
			comparison: atMost(5),
			severity: "high",
		});
		expect(rateLimit.signal).toEqual({
			id: "contributor.recentChangeRequestTimes",
			transform: { kind: "lastCount", window: "24h" },
		});
	});

	test("a literal .last() window wider than the history is a compile error", () => {
		const overWindow = () =>
			// @ts-expect-error a 60d window exceeds the signal's declared 30d history
			signals.contributor.recentChangeRequestTimes.last("60d");
		expect(overWindow).toThrow("asks for more");
	});

	test("a dynamic over-wide window still throws at definition time", () => {
		const fromConfig = "60d" as WindowSpec;
		expect(() =>
			signals.contributor.recentChangeRequestTimes.last(fromConfig),
		).toThrow('provides 30d history; .last("60d") asks for more');
	});

	test("a .last() window inside the history is allowed up to the cap", () => {
		const windowed = signals.contributor.recentChangeRequestTimes.last("30d");
		expect(windowed.ref.transform).toEqual({ kind: "last", window: "30d" });
		expect(windowed.count.valueType.kind).toBe("number");
	});
});

describe("compile-time fences", () => {
	test("a raw registry signal is rejected; only the bound surface authors rules", () => {
		// Compile fence: the raw registry signal lacks the bound surface shape.
		const acceptsWhen = (when: Parameters<typeof rule>[1]["when"]) => when;
		// @ts-expect-error raw registry signals have no bound surface brand
		acceptsWhen(accountAge);
		// Runtime fence for anyone who casts around the type.
		expect(() =>
			rule<number>("raw signal", {
				when: accountAge as never,
				comparison: under(7),
				severity: "low",
			}),
		).toThrow();
	});

	test("a wrong comparison for the signal's type is rejected", () => {
		rule("bad comparison", {
			when: signals.contributor.accountAge,
			// @ts-expect-error matches() is for text signals; accountAge is a number signal
			comparison: matches(/x/),
			severity: "low",
		});
	});

	test("a signal bound to one forge cannot author on another forge's client", () => {
		gappedRule("cross forge", {
			// @ts-expect-error this signal is bound to fake-full, not fake-gapped
			when: signals.contributor.profileText,
			comparison: matches(/hello/),
			severity: "low",
		});
	});
});
