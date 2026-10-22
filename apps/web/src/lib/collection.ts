import { z } from "zod";

export interface CollectionOption<Row> {
	value: string;
	label: string;
	match?: (row: Row) => boolean;
}

interface CollectionChoiceFilter<Row, Key extends string> {
	key: Key;
	label: string;
	kind: "segment" | "select" | "multi";
	options?: readonly CollectionOption<Row>[];
	optionsFrom?: (rows: readonly Row[]) => readonly CollectionOption<Row>[];
	value?: (row: Row) => string | readonly string[];
	defaultValue?: string;
	allLabel?: string;
}

interface CollectionToggleFilter<Row, Key extends string> {
	key: Key;
	label: string;
	kind: "toggle";
	match: (row: Row) => boolean;
}

export type CollectionFilter<Row, Key extends string = string> =
	| CollectionChoiceFilter<Row, Key>
	| CollectionToggleFilter<Row, Key>;

export interface CollectionSort<Row> {
	key: string;
	label: string;
	compare: (a: Row, b: Row) => number;
}

export interface CollectionDefinition<Row, Key extends string = string> {
	id: string;
	noun: string;
	search?: {
		fields: (row: Row) => readonly (string | number | null | undefined)[];
		placeholder?: string;
	};
	filters?: readonly CollectionFilter<Row, Key>[];
	sort?: readonly CollectionSort<Row>[];
	defaultSort?: string;
}

export interface CollectionState {
	q: string;
	sort: string | undefined;
	filters: Record<string, readonly string[]>;
}

export type CollectionParam = string | string[] | boolean;

export type CollectionSearch<Key extends string = string> = {
	[K in "q" | "sort" | Key]?: CollectionParam | undefined;
};

interface CollectionSearchParams {
	q?: string;
	sort?: string;
	[key: string]: CollectionParam | undefined;
}

export interface CollectionResult<Row> {
	rows: Row[];
	total: number;
	filtered: boolean;
	options: Record<string, readonly CollectionOption<Row>[]>;
	counts: Record<string, Record<string, number>>;
	allCounts: Record<string, number>;
}

export const TOGGLE_ON = "on";

export const EMPTY_COLLECTION_STATE: CollectionState = {
	q: "",
	sort: undefined,
	filters: {},
};

export function defineCollection<Row, const Key extends string = string>(
	definition: CollectionDefinition<Row, Key>,
): CollectionDefinition<Row, Key> {
	return definition;
}

function resolveOptions<Row>(
	filter: CollectionFilter<Row>,
	rows: readonly Row[],
): readonly CollectionOption<Row>[] {
	if (filter.kind === "toggle") {
		return [{ value: TOGGLE_ON, label: filter.label, match: filter.match }];
	}
	return filter.optionsFrom?.(rows) ?? filter.options ?? [];
}

export function chosenValues<Row>(
	filter: CollectionFilter<Row>,
	state: CollectionState,
): readonly string[] {
	const chosen = state.filters[filter.key];
	if (chosen !== undefined) {
		return chosen;
	}
	if (filter.kind !== "toggle" && filter.defaultValue !== undefined) {
		return [filter.defaultValue];
	}
	return [];
}

function optionMatches<Row>(
	filter: CollectionFilter<Row>,
	option: CollectionOption<Row> | undefined,
	value: string,
	row: Row,
): boolean {
	if (option?.match) {
		return option.match(row);
	}
	if (filter.kind === "toggle" || !filter.value) {
		return false;
	}
	const own = filter.value(row);
	return Array.isArray(own) ? own.includes(value) : own === value;
}

export function matchesSearch<Row>(
	definition: CollectionDefinition<Row>,
	row: Row,
	query: string,
): boolean {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0 || !definition.search) {
		return true;
	}
	const haystack = definition.search
		.fields(row)
		.filter((field) => field !== null && field !== undefined)
		.join(" ")
		.toLowerCase();
	return terms.every((term) => haystack.includes(term));
}

export function isFiltered<Row>(
	definition: CollectionDefinition<Row>,
	state: CollectionState,
): boolean {
	if (state.q.trim().length > 0) {
		return true;
	}
	return (definition.filters ?? []).some((filter) => {
		const chosen = chosenValues(filter, state);
		const fallback =
			filter.kind !== "toggle" && filter.defaultValue !== undefined
				? [filter.defaultValue]
				: [];
		return (
			chosen.length !== fallback.length ||
			chosen.some((value) => !fallback.includes(value))
		);
	});
}

export function applyCollection<Row>(
	definition: CollectionDefinition<Row>,
	rows: readonly Row[],
	state: CollectionState,
): CollectionResult<Row> {
	const filters = definition.filters ?? [];
	const options = Object.fromEntries(
		filters.map((filter) => [filter.key, resolveOptions(filter, rows)]),
	);
	const tests = filters.map((filter) => {
		const chosen = chosenValues(filter, state);
		const byValue = new Map(
			(options[filter.key] ?? []).map((option) => [option.value, option]),
		);
		return (row: Row) =>
			chosen.length === 0 ||
			chosen.some((value) =>
				optionMatches(filter, byValue.get(value), value, row),
			);
	});
	const counts: Record<string, Record<string, number>> = Object.fromEntries(
		filters.map((filter) => [filter.key, {}]),
	);
	const allCounts: Record<string, number> = Object.fromEntries(
		filters.map((filter) => [filter.key, 0]),
	);
	const visible: Row[] = [];

	for (const row of rows) {
		if (!matchesSearch(definition, row, state.q)) {
			continue;
		}
		const passes = tests.map((test) => test(row));
		if (passes.every(Boolean)) {
			visible.push(row);
		}
		filters.forEach((filter, index) => {
			if (!passes.every((pass, other) => other === index || pass)) {
				return;
			}
			allCounts[filter.key] = (allCounts[filter.key] ?? 0) + 1;
			const tally = counts[filter.key] ?? {};
			for (const option of options[filter.key] ?? []) {
				if (optionMatches(filter, option, option.value, row)) {
					tally[option.value] = (tally[option.value] ?? 0) + 1;
				}
			}
			counts[filter.key] = tally;
		});
	}

	const sort =
		definition.sort?.find((entry) => entry.key === state.sort) ??
		definition.sort?.find((entry) => entry.key === definition.defaultSort) ??
		definition.sort?.[0];
	if (sort) {
		visible.sort(sort.compare);
	}

	return {
		rows: visible,
		total: rows.length,
		filtered: isFiltered(definition, state),
		options,
		counts,
		allCounts,
	};
}

export function collectionSearchSchema<Row, Key extends string>(
	definition: CollectionDefinition<Row, Key>,
) {
	const shape: Record<string, z.ZodType<CollectionParam | undefined>> = {};
	if (definition.search) {
		shape.q = z.string().optional().catch(undefined);
	}
	if (definition.sort && definition.sort.length > 1) {
		shape.sort = z.string().optional().catch(undefined);
	}
	for (const filter of definition.filters ?? []) {
		shape[filter.key] =
			filter.kind === "toggle"
				? z.boolean().optional().catch(undefined)
				: filter.kind === "multi"
					? z.array(z.string()).optional().catch(undefined)
					: z.string().optional().catch(undefined);
	}
	return z.object(shape).transform((parsed) => {
		const search: CollectionSearch<Key> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (value !== undefined) {
				search[key as "q" | "sort" | Key] = value;
			}
		}
		return search;
	});
}

export function decodeCollectionState<Row>(
	definition: CollectionDefinition<Row>,
	search: CollectionSearch,
): CollectionState {
	const q = search.q;
	const sort = search.sort;
	const filters: Record<string, readonly string[]> = {};
	for (const filter of definition.filters ?? []) {
		const raw = search[filter.key];
		if (raw === undefined) {
			continue;
		}
		if (filter.kind === "toggle") {
			filters[filter.key] = raw === true ? [TOGGLE_ON] : [];
			continue;
		}
		if (Array.isArray(raw)) {
			filters[filter.key] = raw;
			continue;
		}
		if (raw === true || raw === false) {
			continue;
		}
		filters[filter.key] = raw === "" ? [] : [raw];
	}
	return {
		q:
			q === undefined || q === true || q === false || Array.isArray(q) ? "" : q,
		sort:
			sort === undefined ||
			sort === true ||
			sort === false ||
			Array.isArray(sort)
				? undefined
				: sort,
		filters,
	};
}

export function encodeCollectionState<Row>(
	definition: CollectionDefinition<Row>,
	state: CollectionState,
): CollectionSearchParams {
	const search: CollectionSearchParams = {
		q: state.q.length > 0 ? state.q : undefined,
		sort:
			state.sort !== undefined &&
			state.sort !== (definition.defaultSort ?? definition.sort?.[0]?.key)
				? state.sort
				: undefined,
	};
	for (const filter of definition.filters ?? []) {
		const chosen = chosenValues(filter, state);
		if (filter.kind === "toggle") {
			search[filter.key] = chosen.includes(TOGGLE_ON) ? true : undefined;
			continue;
		}
		if (filter.kind === "multi") {
			search[filter.key] = chosen.length > 0 ? [...chosen] : undefined;
			continue;
		}
		const value = chosen[0];
		if (filter.defaultValue !== undefined) {
			search[filter.key] =
				value === filter.defaultValue ? undefined : (value ?? "");
			continue;
		}
		search[filter.key] = value;
	}
	return search;
}
