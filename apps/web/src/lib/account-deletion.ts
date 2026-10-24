export type DeletionStep = "blocked" | "repos" | "checks" | "confirm";

export function deletionSteps(counts: {
	soleAdminOrgs: number;
	onRepos: number;
}): DeletionStep[] {
	if (counts.soleAdminOrgs > 0) {
		return ["blocked"];
	}
	return counts.onRepos > 0
		? ["repos", "checks", "confirm"]
		: ["checks", "confirm"];
}

export function installationSettingsUrl(install: {
	forge: string;
	accountLogin: string | null;
	accountType: string | null;
}): string | null {
	if (install.forge !== "github") {
		return null;
	}
	if (install.accountType === "Organization" && install.accountLogin) {
		return `https://github.com/organizations/${encodeURIComponent(install.accountLogin)}/settings/installations`;
	}
	return "https://github.com/settings/installations";
}
