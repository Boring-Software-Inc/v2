import { FORGE_CATALOG, type ProviderAvailability } from "@tripwire/contracts";

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Both grids consume the same server decision; action-specific access is checked separately. */
export function availableForges(
	availability: ProviderAvailability | undefined,
) {
	return FORGE_CATALOG.map((forge) => ({
		...forge,
		available: availability?.available.includes(forge.id) ?? false,
	}));
}

export function availableForgeLabels(
	availability: ProviderAvailability | undefined,
) {
	return LIST.format(
		availableForges(availability)
			.filter((forge) => forge.available)
			.map((forge) => forge.label),
	);
}
