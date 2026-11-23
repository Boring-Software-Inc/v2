import { FORGE_BY_ID, type Forge } from "@tripwire/contracts";

interface RepoLabelIdentity {
	forge: Forge;
	owner: string;
	name: string;
}

/** Repository names that need owner and forge context in a shared list. */
export function duplicateRepoNames(
	repos: readonly Pick<RepoLabelIdentity, "name">[],
): ReadonlySet<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const repo of repos) {
		if (seen.has(repo.name)) duplicates.add(repo.name);
		seen.add(repo.name);
	}
	return duplicates;
}

/** Human-readable identity for otherwise indistinguishable namesakes. */
export function qualifiedRepoLabel(repo: RepoLabelIdentity): string {
	return `${repo.owner}/${repo.name} · ${FORGE_BY_ID[repo.forge].label}`;
}
