import {
	FORGE_CATALOG,
	type Forge,
	type OrganizationForgeConnection,
	type ProviderAvailability,
} from "@tripwire/contracts";

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

export function forgeInstallationSettingsUrl(
	forge: Forge,
	installation:
		| OrganizationForgeConnection["installations"][number]
		| undefined,
): string | null {
	if (!installation) return null;
	const id = encodeURIComponent(installation.installationId);
	if (forge === "gitcafe" && installation.owner)
		return `https://git.cafe/orgs/${encodeURIComponent(installation.owner)}/settings/apps/${id}`;
	if (forge === "github" && /^\d+$/.test(installation.installationId)) {
		if (installation.accountType === "User")
			return `https://github.com/settings/installations/${id}`;
		if (installation.accountType === "Organization" && installation.owner)
			return `https://github.com/organizations/${encodeURIComponent(installation.owner)}/settings/installations/${id}`;
	}
	return null;
}
