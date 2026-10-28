import {
	FORGE_CATALOG,
	type ForgeId,
	forgeConnectable,
} from "@tripwire/contracts";

export function connectForges(hasFlow: (id: ForgeId) => boolean) {
	return FORGE_CATALOG.map((forge) => ({
		...forge,
		available: forgeConnectable(forge.id) && hasFlow(forge.id),
	}));
}
