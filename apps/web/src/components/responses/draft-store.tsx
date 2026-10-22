import {
	createContext,
	type ReactNode,
	useContext,
	useState,
	useSyncExternalStore,
} from "react";
import type { DraftKey } from "#/components/responses/responses-model";

type Drafts = Partial<Record<DraftKey, string>>;

export interface DraftStore {
	get: () => Drafts;
	set: (key: DraftKey, value: string) => void;
	clear: (key: DraftKey) => void;
	subscribe: (listener: () => void) => () => void;
}

const EMPTY: Drafts = {};

function createDraftStore(): DraftStore {
	let drafts: Drafts = EMPTY;
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	return {
		get: () => drafts,
		set: (key, value) => {
			if (drafts[key] === value) {
				return;
			}
			drafts = { ...drafts, [key]: value };
			emit();
		},
		clear: (key) => {
			if (!(key in drafts)) {
				return;
			}
			const { [key]: _removed, ...rest } = drafts;
			drafts = Object.keys(rest).length === 0 ? EMPTY : rest;
			emit();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const DraftStoreContext = createContext<DraftStore | null>(null);

export function DraftStoreProvider({ children }: { children: ReactNode }) {
	const [store] = useState(createDraftStore);
	return <DraftStoreContext value={store}>{children}</DraftStoreContext>;
}

export function useDraftStore(): DraftStore {
	const store = useContext(DraftStoreContext);
	if (!store) {
		throw new Error("useDraftStore needs a DraftStoreProvider");
	}
	return store;
}

export function useDrafts(): Drafts {
	const store = useDraftStore();
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}
