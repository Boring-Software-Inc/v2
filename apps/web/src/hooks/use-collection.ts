import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	applyCollection,
	type CollectionDefinition,
	type CollectionResult,
	type CollectionSearch,
	type CollectionState,
	decodeCollectionState,
	EMPTY_COLLECTION_STATE,
	encodeCollectionState,
	mergeCollectionParams,
	readCollectionParams,
	writeCollectionParams,
} from "#/lib/collection";

export interface CollectionController<Row> extends CollectionResult<Row> {
	definition: CollectionDefinition<Row>;
	state: CollectionState;
	loading: boolean;
	setQuery: (q: string) => void;
	setFilter: (key: string, values: readonly string[]) => void;
	setSort: (key: string) => void;
	clear: () => void;
}

const WRITTEN_MEMORY = 32;

export function useCollection<Row>(
	definition: CollectionDefinition<Row>,
	rows: readonly Row[] | undefined,
	{
		store = "url",
		params,
	}: { store?: "url" | "local"; params?: Record<string, string> } = {},
): CollectionController<Row> {
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as CollectionSearch;
	const fromUrl = store === "url";

	const urlState = fromUrl
		? decodeCollectionState(definition, readCollectionParams(search, params))
		: EMPTY_COLLECTION_STATE;
	const urlKey = JSON.stringify(
		writeCollectionParams(encodeCollectionState(definition, urlState), params),
	);

	const [state, setLocalState] = useState<CollectionState>(urlState);
	const [seen, setSeen] = useState(urlKey);
	const [written, setWritten] = useState<readonly string[]>([urlKey]);

	if (fromUrl && urlKey !== seen) {
		setSeen(urlKey);
		if (urlKey === written.at(-1) || !written.includes(urlKey)) {
			setWritten([urlKey]);
		}
		if (!written.includes(urlKey)) {
			setLocalState(
				params ? mergeCollectionParams(state, urlState, params) : urlState,
			);
		}
	}

	const setState = (next: CollectionState) => {
		setLocalState(next);
		if (!fromUrl) {
			return;
		}
		const encoded = writeCollectionParams(
			encodeCollectionState(definition, next),
			params,
		);
		setWritten((keys) => [
			...keys.slice(-WRITTEN_MEMORY),
			JSON.stringify(encoded),
		]);
		void navigate({
			to: ".",
			search: (prev) => ({ ...prev, ...encoded }),
			replace: true,
			resetScroll: false,
		});
	};

	const result = useMemo(
		() => applyCollection(definition, rows ?? [], state),
		[definition, rows, state],
	);

	return {
		...result,
		definition,
		state,
		loading: rows === undefined,
		setQuery: (q) => setState({ ...state, q }),
		setFilter: (key, values) =>
			setState({ ...state, filters: { ...state.filters, [key]: values } }),
		setSort: (sort) => setState({ ...state, sort }),
		clear: () => setState({ ...state, q: "", filters: {} }),
	};
}
