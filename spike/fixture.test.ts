import { describe, expect, test } from "bun:test";
import {
	accountAge,
	defineForge,
	displayName,
	forgeJoe,
	type GithubClient,
	github,
	isFirstContribution,
	type ProducerMap,
	Tripwire,
} from "./fixture.ts";

describe("spike forge signal narrowing", () => {
	test("exposes only supported signals without invoking producers", () => {
		const full = new Tripwire({ forge: github });
		expect(full.signals.contributor).toEqual({ accountAge, displayName });
		expect(full.signals.pr).toEqual({ isFirstContribution });
		const partial = new Tripwire({ forge: forgeJoe });
		expect(partial.signals.contributor).toEqual({ displayName });
		const { rule } = partial;
		expect(
			rule("named", {
				when: displayName,
				comparison: { kind: "matches", args: [/bot/] },
				severity: "high",
			}),
		).toEqual({
			name: "named",
			signal: displayName.id,
			comparison: { kind: "matches", args: [/bot/] },
			severity: "high",
		});
	});

	test("retains inherited producer support", () => {
		let calls = 0;
		const produces: ProducerMap<GithubClient> = {};
		Object.setPrototypeOf(produces, {
			[accountAge.id]: () => {
				calls += 1;
				return 1;
			},
		});
		const forge = defineForge<GithubClient>()({ id: "inherited", produces });
		const tripwire = new Tripwire({ forge });
		expect(Object.keys(tripwire.signals.contributor)).toEqual(["accountAge"]);
		expect(Object.keys(tripwire.signals.pr)).toEqual([]);
		expect(calls).toBe(0);
	});
});
