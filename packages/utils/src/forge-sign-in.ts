import { FORGE_CATALOG, type ForgeId, forgeSignIn } from "@tripwire/contracts";

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export function signInForges(providerIds: readonly ForgeId[]) {
	return FORGE_CATALOG.map((forge) => ({
		...forge,
		available: forgeSignIn(forge.id) !== null && providerIds.includes(forge.id),
	}));
}

export function signInForgeLabels(providerIds: readonly ForgeId[]) {
	return LIST.format(
		signInForges(providerIds)
			.filter((forge) => forge.available)
			.map((forge) => forge.label),
	);
}
