import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { useRepoTabTarget } from "#/components/tabs/repo-tab-target";
import {
	parseStoredRepoTabs,
	REPO_TABS_STORAGE_KEY,
	type RepoTab,
	type RepoTabsAction,
	repoTabsReducer,
} from "#/components/tabs/repo-tabs-state";

interface RepoTabsContextValue {
	/** False until localStorage has been read — the strip renders nothing until then. */
	hydrated: boolean;
	tabs: RepoTab[];
	closeTab: (id: string) => void;
}

const RepoTabsContext = createContext<RepoTabsContextValue | null>(null);

/**
 * Visited repos, kept as tabs across reloads. There is no stored "active tab":
 * the URL is the scope (§8), so the active tab is whichever one the current
 * route resolves to, and org home is simply the state where none is active.
 */
export function RepoTabsProvider({ children }: { children: ReactNode }) {
	const [tabs, dispatch] = useReducer(repoTabsReducer, []);
	const [hydrated, setHydrated] = useState(false);
	// The first post-hydration effect run would otherwise write the empty
	// initial state back over the stored tabs before the load lands.
	const skipNextPersist = useRef(true);

	useEffect(() => {
		const raw = window.localStorage.getItem(REPO_TABS_STORAGE_KEY);
		dispatch({ type: "hydrate", tabs: raw ? parseStoredRepoTabs(raw) : [] });
		skipNextPersist.current = true;
		setHydrated(true);
	}, []);

	useEffect(() => {
		if (!hydrated) {
			return;
		}
		if (skipNextPersist.current) {
			skipNextPersist.current = false;
			return;
		}
		try {
			window.localStorage.setItem(REPO_TABS_STORAGE_KEY, JSON.stringify(tabs));
		} catch {
			// Quota or a locked-down storage partition — the strip still works for
			// this session, it just won't survive the reload.
		}
	}, [hydrated, tabs]);

	const closeTab = useCallback((id: string) => {
		dispatch({ type: "close", id });
	}, []);

	const value = useMemo(
		() => ({ hydrated, tabs, closeTab }),
		[hydrated, tabs, closeTab],
	);

	return (
		<RepoTabsContext.Provider value={value}>
			<RepoTabsRouteSync hydrated={hydrated} dispatch={dispatch} />
			{children}
		</RepoTabsContext.Provider>
	);
}

/**
 * Opening a tab is a side effect of navigation, never of a click handler — any
 * route into a repo (a link, the command palette, a pasted URL, the back
 * button) lands the same tab.
 */
function RepoTabsRouteSync({
	hydrated,
	dispatch,
}: {
	hydrated: boolean;
	dispatch: (action: RepoTabsAction) => void;
}) {
	const target = useRepoTabTarget();

	useEffect(() => {
		if (!hydrated || !target) {
			return;
		}
		dispatch({ type: "open", tab: target });
	}, [dispatch, hydrated, target]);

	return null;
}

export function useRepoTabs(): RepoTabsContextValue {
	const context = useContext(RepoTabsContext);
	if (!context) {
		throw new Error("useRepoTabs must be used within RepoTabsProvider");
	}
	return context;
}
