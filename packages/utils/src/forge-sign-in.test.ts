import { describe, expect, test } from "bun:test";
import { FORGE_CATALOG, type ProviderAvailability } from "@tripwire/contracts";
import { availableForgeLabels, availableForges } from "./forge-sign-in.ts";

describe("advertised provider availability", () => {
	test("missing availability enables neither grid", () => {
		expect(availableForges(undefined).every((forge) => !forge.available)).toBe(
			true,
		);
		expect(availableForgeLabels(undefined)).toBe("");
	});
	test("the single list determines both grids without a catalog veto", () => {
		const availability: ProviderAvailability = {
			available: ["github", "gitcafe"],
		};
		expect(availableForges(availability).map((forge) => forge.id)).toEqual(
			FORGE_CATALOG.map((forge) => forge.id),
		);
		expect(
			availableForges(availability)
				.filter((forge) => forge.available)
				.map((forge) => forge.id),
		).toEqual(["github", "gitcafe"]);
		expect(availableForgeLabels(availability)).toBe("GitHub and GitCafe");
		expect(
			availableForges({ available: ["github"] }).find(
				(forge) => forge.id === "gitcafe",
			)?.available,
		).toBe(false);
	});
});
