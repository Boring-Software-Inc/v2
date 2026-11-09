import { describe, expect, test } from "bun:test";
import { FORGE_CATALOG, type ProviderAvailability } from "@tripwire/contracts";
import {
	availableForgeLabels,
	availableForges,
	forgeInstallationSettingsUrl,
} from "./forge-sign-in.ts";

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

test("installation settings use verified forge and account metadata", () => {
	expect(
		forgeInstallationSettingsUrl("gitcafe", {
			installationId: "ins/one",
			owner: "boring/team",
			accountType: "Organization",
		}),
	).toBe("https://git.cafe/orgs/boring%2Fteam/settings/apps/ins%2Fone");
	expect(
		forgeInstallationSettingsUrl("github", {
			installationId: "123",
			owner: "boring",
			accountType: "Organization",
		}),
	).toBe("https://github.com/organizations/boring/settings/installations/123");
	expect(
		forgeInstallationSettingsUrl("github", {
			installationId: "123",
			owner: "grim",
			accountType: "User",
		}),
	).toBe("https://github.com/settings/installations/123");
	expect(
		forgeInstallationSettingsUrl("github", {
			installationId: "123",
			owner: "boring",
			accountType: null,
		}),
	).toBeNull();
	expect(
		forgeInstallationSettingsUrl("github", {
			installationId: "ins-one",
			owner: "boring",
			accountType: "Organization",
		}),
	).toBeNull();
	expect(
		forgeInstallationSettingsUrl("opengit", {
			installationId: "123",
			owner: "boring",
			accountType: "Organization",
		}),
	).toBeNull();
	expect(forgeInstallationSettingsUrl("gitcafe", undefined)).toBeNull();
});
