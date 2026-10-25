import {
	FORGE_CATALOG,
	type ForgeId,
	forgeConnectable,
	forgeSignIn,
} from "@tripwire/contracts";

export function signInForges() {
	return FORGE_CATALOG.map((forge) => ({
		...forge,
		available: forgeSignIn(forge.id) !== null,
	}));
}

export function connectForges(hasFlow: (id: ForgeId) => boolean) {
	return FORGE_CATALOG.map((forge) => ({
		...forge,
		available: forgeConnectable(forge.id) && hasFlow(forge.id),
	}));
}
