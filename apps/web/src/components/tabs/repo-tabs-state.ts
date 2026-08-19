export interface RepoTab {
	/** `org/repo` — stable identity and the visible label. */
	id: string;
	org: string;
	repo: string;
	/** Last page visited in this repo, so reopening the tab lands where you left. */
	path: string;
}

/**
 * v2 drops anything written before per-tab paths were pinned to their own repo:
 * that build could stamp the page you navigated AWAY to onto the tab you left.
 */
export const REPO_TABS_STORAGE_KEY = "tripwire.repo-tabs.v2";

export type RepoTabsAction =
	| { type: "hydrate"; tabs: RepoTab[] }
	| { type: "open"; tab: RepoTab }
	| { type: "close"; id: string };

export function repoTabsReducer(
	tabs: RepoTab[],
	action: RepoTabsAction,
): RepoTab[] {
	switch (action.type) {
		case "hydrate":
			return action.tabs;
		case "open": {
			const index = tabs.findIndex((tab) => tab.id === action.tab.id);
			// New repos append to the end; the strip scrolls rather than evicting,
			// so the set stays exactly what the user opened.
			if (index === -1) {
				return [...tabs, action.tab];
			}
			if (tabs[index]?.path === action.tab.path) {
				return tabs;
			}
			// Only the tab you're actually on is rewritten — every other tab keeps
			// the page it was left on, so switching away and back returns you there.
			return tabs.map((tab, i) => (i === index ? action.tab : tab));
		}
		case "close":
			return tabs.filter((tab) => tab.id !== action.id);
	}
}

/**
 * Tolerates anything in storage: a shape change ships a shorter strip rather
 * than throwing on read and losing the whole set.
 */
export function parseStoredRepoTabs(raw: string): RepoTab[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const tabs: RepoTab[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const { org, repo, path } = item as Record<string, unknown>;
		if (typeof org !== "string" || typeof repo !== "string") {
			continue;
		}
		tabs.push({
			id: `${org}/${repo}`,
			org,
			repo,
			path: resolveRepoTabPath(org, repo, typeof path === "string" ? path : ""),
		});
	}
	return tabs;
}

/** True when `pathname` is the repo's own root or a page under it. */
export function isPathInRepo(
	org: string,
	repo: string,
	pathname: string,
): boolean {
	const root = `/${org}/${repo}`;
	return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * A tab may only ever point inside its own repo. Anything else — a stale write,
 * a hand-edited storage entry — falls back to the repo root.
 */
export function resolveRepoTabPath(
	org: string,
	repo: string,
	pathname: string,
): string {
	return isPathInRepo(org, repo, pathname) ? pathname : `/${org}/${repo}`;
}

/**
 * The tab the router state describes, or null when it describes no repo.
 *
 * A mismatch between the matched repo and the pathname means the router is
 * mid-navigation: `location` commits a tick before `matches` does, so the two
 * briefly describe different pages. That pairing is NOT a tab — resolving it to
 * the outgoing repo's root would re-open a tab the user just closed (appending
 * it at the end, which reads as the strip reordering itself) and point it at a
 * page they weren't on. Emitting nothing lets the next commit settle it.
 */
export function repoTabForLocation(
	org: string | undefined,
	repo: string | undefined,
	pathname: string,
): RepoTab | null {
	if (!org || !repo || !isPathInRepo(org, repo, pathname)) {
		return null;
	}
	return { id: `${org}/${repo}`, org, repo, path: pathname };
}
