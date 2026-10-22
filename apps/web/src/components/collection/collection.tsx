import type { ReactNode } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	FilterBar,
	FilterBarClear,
	FilterBarCount,
	FilterBarSearch,
	FilterBarSelect,
	FilterToggle,
} from "#/components/glaze/ui/filter-bar";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import type { CollectionController } from "#/hooks/use-collection";
import {
	type CollectionFilter,
	chosenValues,
	TOGGLE_ON,
} from "#/lib/collection";

const SEGMENT_LIMIT = 5;
const ALL = "__all__";

const capitalize = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

export interface CollectionProps<Row> {
	collection: CollectionController<Row>;
	skeleton: ReactNode;
	empty: ReactNode;
	error?: boolean;
	onRetry?: () => Promise<void>;
	noResults?: ReactNode;
	variant?: "panel" | "plain";
	children: (rows: Row[]) => ReactNode;
}

export function Collection<Row>({
	collection,
	skeleton,
	empty,
	error = false,
	onRetry,
	noResults,
	variant = "panel",
	children,
}: CollectionProps<Row>) {
	const { definition, loading, total, rows } = collection;
	const failed = error && loading;

	if (failed) {
		return (
			<Empty
				reason="error"
				size={variant === "plain" ? "sm" : "default"}
				variant={variant}
			>
				<EmptyHeader>
					<EmptyTitle>{capitalize(definition.noun)} did not load</EmptyTitle>
					<EmptyDescription>
						Tripwire could not load {definition.noun}. Check your connection,
						then try again.
					</EmptyDescription>
				</EmptyHeader>
				{onRetry ? (
					<EmptyContent>
						<EmptyRetry onRetry={onRetry}>
							Load {definition.noun} again
						</EmptyRetry>
					</EmptyContent>
				) : null}
			</Empty>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{!loading && total > 0 ? (
				<CollectionControls collection={collection} />
			) : null}
			<SkeletonSwap
				fallback={skeleton}
				label={`Loading ${definition.noun}`}
				loading={loading}
			>
				{loading
					? null
					: total === 0
						? empty
						: rows.length === 0
							? (noResults ?? (
									<CollectionNoResults
										collection={collection}
										variant={variant}
									/>
								))
							: children(rows)}
			</SkeletonSwap>
		</div>
	);
}

function CollectionNoResults<Row>({
	collection,
	variant,
}: {
	collection: CollectionController<Row>;
	variant: "panel" | "plain";
}) {
	return (
		<Empty
			reason="no-results"
			size={variant === "plain" ? "sm" : "default"}
			variant={variant}
		>
			<EmptyHeader>
				<EmptyTitle>No {collection.definition.noun} match</EmptyTitle>
			</EmptyHeader>
			{collection.filtered ? (
				<EmptyContent>
					<Button onClick={collection.clear} size="sm" variant="secondary">
						Clear filters
					</Button>
				</EmptyContent>
			) : null}
		</Empty>
	);
}

function CollectionControls<Row>({
	collection,
}: {
	collection: CollectionController<Row>;
}) {
	const { definition, state } = collection;
	const filters = definition.filters ?? [];
	const sorts = definition.sort ?? [];
	const segments = filters.filter(
		(filter) =>
			filter.kind === "segment" &&
			(collection.options[filter.key]?.length ?? 0) +
				(filter.allLabel ? 1 : 0) <=
				SEGMENT_LIMIT,
	);
	const chips = filters.filter((filter) => !segments.includes(filter));

	return (
		<FilterBar aria-label={`Filter ${definition.noun}`}>
			{segments.map((filter) => (
				<CollectionSegment
					collection={collection}
					filter={filter}
					key={filter.key}
				/>
			))}
			{definition.search ? (
				<FilterBarSearch
					aria-label={`Search ${definition.noun}`}
					onValueChange={collection.setQuery}
					placeholder={definition.search.placeholder ?? "Search"}
					value={state.q}
				/>
			) : null}
			{chips.map((filter) => (
				<CollectionChip
					collection={collection}
					filter={filter}
					key={filter.key}
				/>
			))}
			{sorts.length > 1 ? (
				<FilterBarSelect
					defaultValue={definition.defaultSort ?? sorts[0]?.key}
					label="Sort"
					onValueChange={(value) => {
						if (value) {
							collection.setSort(value);
						}
					}}
					options={sorts.map((sort) => ({
						value: sort.key,
						label: sort.label,
					}))}
					value={state.sort ?? definition.defaultSort ?? sorts[0]?.key}
				/>
			) : null}
			{collection.filtered ? (
				<>
					<FilterBarCount
						noun={definition.noun}
						shown={collection.rows.length}
						total={collection.total}
					/>
					<FilterBarClear onClick={collection.clear}>
						Clear filters
					</FilterBarClear>
				</>
			) : null}
		</FilterBar>
	);
}

function CollectionSegment<Row>({
	collection,
	filter,
}: {
	collection: CollectionController<Row>;
	filter: CollectionFilter<Row>;
}) {
	const options = collection.options[filter.key] ?? [];
	const counts = collection.counts[filter.key] ?? {};
	const value = chosenValues(filter, collection.state)[0] ?? ALL;
	const allLabel = filter.kind === "toggle" ? undefined : filter.allLabel;
	return (
		<SegmentedControl
			aria-label={filter.label}
			size="sm"
			onValueChange={(next) =>
				collection.setFilter(filter.key, next === ALL ? [] : [next])
			}
			value={value}
		>
			{allLabel ? (
				<SegmentedControlItem
					count={collection.allCounts[filter.key]}
					value={ALL}
				>
					{allLabel}
				</SegmentedControlItem>
			) : null}
			{options.map((option) => (
				<SegmentedControlItem
					count={counts[option.value] ?? 0}
					key={option.value}
					value={option.value}
				>
					{option.label}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}

function CollectionChip<Row>({
	collection,
	filter,
}: {
	collection: CollectionController<Row>;
	filter: CollectionFilter<Row>;
}) {
	const counts = collection.counts[filter.key] ?? {};
	const chosen = chosenValues(filter, collection.state);

	if (filter.kind === "toggle") {
		return (
			<FilterToggle
				count={counts[TOGGLE_ON] ?? 0}
				onPressedChange={(pressed) =>
					collection.setFilter(filter.key, pressed ? [TOGGLE_ON] : [])
				}
				pressed={chosen.includes(TOGGLE_ON)}
			>
				{filter.label}
			</FilterToggle>
		);
	}

	const options = (collection.options[filter.key] ?? []).map((option) => ({
		value: option.value,
		label: option.label,
		count: counts[option.value] ?? 0,
	}));

	if (filter.kind === "multi") {
		return (
			<FilterBarSelect
				label={filter.label}
				multiple
				onValueChange={(values) => collection.setFilter(filter.key, values)}
				options={options}
				value={[...chosen]}
			/>
		);
	}

	return (
		<FilterBarSelect
			allLabel={filter.allLabel}
			defaultValue={filter.defaultValue ?? null}
			label={filter.label}
			onValueChange={(value) =>
				collection.setFilter(filter.key, value ? [value] : [])
			}
			options={options}
			showAllOption={filter.defaultValue === undefined}
			value={chosen[0] ?? null}
		/>
	);
}
