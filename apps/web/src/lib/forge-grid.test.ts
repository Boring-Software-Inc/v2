import { describe, expect, test } from "bun:test";
import { FORGE_CATALOG } from "@tripwire/contracts";
import { signInForgeLabels, signInForges } from "@tripwire/utils";
import { connectForges } from "#/lib/forge-grid";

const catalogIds = FORGE_CATALOG.map((forge) => forge.id);

const availability = (forges: readonly { id: string; available: boolean }[]) =>
	Object.fromEntries(forges.map((forge) => [forge.id, forge.available]));

describe("sign-in grid", () => {
	test("lists every forge in catalog order", () => {
		expect(signInForges([]).map((forge) => forge.id)).toEqual(catalogIds);
	});

	test("catalog support alone cannot enable a provider", () => {
		expect(availability(signInForges([]))).toEqual({
			github: false,
			opengit: false,
			gitlab: false,
			gitcafe: false,
		});
	});

	test("requires server registration for GitCafe while preserving GitHub", () => {
		expect(availability(signInForges(["github"]))).toEqual({
			github: true,
			opengit: false,
			gitlab: false,
			gitcafe: false,
		});
		expect(availability(signInForges(catalogIds))).toEqual({
			github: true,
			opengit: false,
			gitlab: false,
			gitcafe: true,
		});
		expect(availability(signInForges(["gitcafe"])).github).toBe(false);
	});

	test("sign-in copy names only configured and supported providers", () => {
		expect(signInForgeLabels([])).toBe("");
		expect(signInForgeLabels(["github"])).toBe("GitHub");
		expect(signInForgeLabels(catalogIds)).toBe("GitHub and GitCafe");
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
