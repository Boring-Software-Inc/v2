import {
	FORGE_CATALOG,
	type ForgeId,
	forgeConnectable,
	forgeSignIn,
} from "@tripwire/contracts";

export function signInForges() {
	return FORGE_CATALOG.filter((forge) => forgeSignIn(forge.id) !== null);
}

export function connectForges(hasFlow: (id: ForgeId) => boolean) {
	return FORGE_CATALOG.filter(
		(forge) => forgeConnectable(forge.id) && hasFlow(forge.id),
	);
}
