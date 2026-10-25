import { describe, expect, test } from "bun:test";
import { FORGE_CATALOG } from "@tripwire/contracts";
import { connectForges, signInForges } from "#/lib/forge-grid";

const catalogIds = FORGE_CATALOG.map((forge) => forge.id);

const availability = (forges: readonly { id: string; available: boolean }[]) =>
	Object.fromEntries(forges.map((forge) => [forge.id, forge.available]));

describe("sign-in grid", () => {
	test("lists every forge in catalog order", () => {
		expect(signInForges().map((forge) => forge.id)).toEqual(catalogIds);
	});

	test("enables only forges you can sign in with", () => {
		expect(availability(signInForges())).toEqual({
			github: true,
			opengit: false,
			gitlab: false,
			gitcafe: false,
		});
	});
});

describe("connect grid", () => {
	test("lists every forge in catalog order", () => {
		expect(connectForges(() => true).map((forge) => forge.id)).toEqual(
			catalogIds,
		);
	});

	test("enables only forges that can be connected", () => {
		expect(availability(connectForges(() => true))).toEqual({
			github: true,
			opengit: false,
			gitlab: false,
			gitcafe: false,
		});
	});

	test("disables a connectable forge with no connect flow", () => {
		expect(availability(connectForges((id) => id !== "github")).github).toBe(
			false,
		);
	});
});
