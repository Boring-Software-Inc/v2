"use client";

import { ChoiceChip, type ChoiceChipProps } from "@tripwire/ui/chip";
import { Input } from "@tripwire/ui/field";
import { Icon, Search } from "@tripwire/ui/icon";
import { Menu, type MenuEntry } from "@tripwire/ui/menu";
import * as React from "react";

import "./filter-bar.css";

function classes(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(" ");
}

function CaretIcon() {
	return (
		<svg aria-hidden className="size-3" viewBox="0 0 12 12">
			<title>Open</title>
			<path
				d="m3 4.5 3 3 3-3"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
			/>
		</svg>
	);
}

// Tripwire's filter bar: the row above a list or a table that narrows it. One row of separate 26px controls, 8px apart:
// the search (Input's search mode, small; "/" focuses it from anywhere, Escape clears it), then the filters as chips.
// A filter with values (FilterBarSelect) is a chip with a caret that opens a menu; a quick filter (FilterToggle) is a
// Chip that sits pressed. A set filter takes the pressed chip's look, the wash and the darkened line: flat, never
// glass, because a row of filters has no lead. The count and Clear all keep the row's end; under 28rem the search
// takes its own row.
//
// Each option in a filter's menu shows how many rows it would leave, counted against the search, every other filter
// and every pressed toggle, not the whole list. An option that would leave nothing sinks below a rule and goes quiet,
// so the person sees before picking that it empties the list. useFilteredRows computes the rows and those counts in
// one pass.

/**
 * The row. role="search": name it with aria-label. Children sit in one row, 8px apart: the search, the filter chips,
 * then the count and Clear all pinned to the end. Chips, the count and Clear keep their width; the search takes what
 * is left, down to 128px. Under 28rem of bar the search takes a row of its own and the chips and count go under it; under 18rem the count is
 * only heard, not shown.
 */
function FilterBar({ className, ...props }: React.ComponentProps<"search">) {
	return (
		<search
			data-slot="filter-bar"
			className={classes(
				"@container flex w-full min-w-0 flex-wrap items-center gap-2",
				"[&>[data-slot=filter-bar-count]]:ms-auto [&>[data-slot=filter-bar-clear]]:ms-auto [&>[data-slot=filter-bar-count]~[data-slot=filter-bar-clear]]:ms-0",
				"@max-2xs:[&>[data-slot=filter-bar-count]]:sr-only @max-2xs:[&>[data-slot=filter-bar-count]~[data-slot=filter-bar-clear]]:ms-auto",
				className,
			)}
			{...props}
		/>
	);
}

// ---------- Search ----------

type FilterBarSearchProps = {
	"aria-label"?: string;
	placeholder?: string;
	value: string;
	onValueChange: (value: string) => void;
	/** The key that focuses the search from anywhere outside a field, dialog or menu. null turns it off. */
	shortcut?: string | null;
};

/** The bar's search: Input's search mode at 26px, named by its placeholder, filling the row's spare width; its own row when the bar is narrow. */
function FilterBarSearch({
	shortcut = "/",
	placeholder = "Search",
	"aria-label": ariaLabel,
	onValueChange,
	value,
}: FilterBarSearchProps) {
	const ref = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		if (!shortcut) return;
		const focus = (event: globalThis.KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.key !== shortcut ||
				event.defaultPrevented ||
				event.isComposing ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				target?.closest(
					"input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]",
				)
			)
				return;
			event.preventDefault();
			ref.current?.focus();
		};
		document.addEventListener("keydown", focus);
		return () => document.removeEventListener("keydown", focus);
	}, [shortcut]);
	return (
		<div
			className="min-w-32 flex-1 basis-40 @max-md:basis-full"
			data-slot="filter-bar-search"
		>
			<Input
				ref={ref}
				type="search"
				appearance="compact-search"
				leadingIcon={<Icon icon={Search} size={12} />}
				placeholder={placeholder}
				ariaLabel={ariaLabel ?? placeholder}
				ariaKeyShortcuts={shortcut ?? undefined}
				showShortcutHint={!value}
				value={value}
				onValueChange={onValueChange}
				onKeyDown={(event) => {
					if (
						event.key === "Escape" &&
						value &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault();
						onValueChange("");
					}
				}}
			/>
		</div>
	);
}

// ---------- Chips and toggles ----------

type FilterToggleProps = Omit<ChoiceChipProps, "label"> & { children: string };

function FilterToggle({ children, ...props }: FilterToggleProps) {
	return <ChoiceChip label={children} {...props} />;
}

type FilterBarButtonProps = React.ComponentProps<"button"> & {
	active?: boolean;
};

function FilterBarButton({
	active,
	className,
	children,
	...props
}: FilterBarButtonProps) {
	return (
		<button
			type="button"
			data-filter-bar-control="button"
			data-slot="filter-bar-button"
			data-active={active || undefined}
			className={className}
			{...props}
		>
			{children}
		</button>
	);
}

/** Clears everything. Render it only while something differs from its default; it hands focus to the search when it goes. */
function FilterBarClear({
	className,
	children = "Clear all",
	onClick,
	...props
}: Omit<FilterBarButtonProps, "active">) {
	return (
		<FilterBarButton
			data-slot="filter-bar-clear"
			onClick={(event) => {
				const bar = (event.currentTarget as HTMLElement).closest(
					"[data-slot=filter-bar]",
				);
				onClick?.(event);
				requestAnimationFrame(() => {
					if (
						document.activeElement &&
						document.activeElement !== document.body
					)
						return;
					bar
						?.querySelector<HTMLElement>(
							"[data-mode=search] [data-control], [data-slot=filter-bar-select]",
						)
						?.focus();
				});
			}}
			className={className}
			{...props}
		>
			{children}
		</FilterBarButton>
	);
}

/**
 * "128 of 1,204 runs". The visible count updates at once; the announcement waits for typing to pause for 500ms, so a
 * screen reader hears one count, not one per key.
 */
function FilterBarCount({
	shown,
	total,
	noun,
	className,
	...props
}: React.ComponentProps<"div"> & {
	shown: number;
	total: number;
	noun?: string;
}) {
	const f = (n: number) => n.toLocaleString("en-US");
	const text =
		shown === total
			? `${f(total)}${noun ? ` ${noun}` : ""}`
			: `${f(shown)} of ${f(total)}${noun ? ` ${noun}` : ""}`;
	const [said, setSaid] = React.useState(text);
	React.useEffect(() => {
		const id = window.setTimeout(() => setSaid(text), 500);
		return () => window.clearTimeout(id);
	}, [text]);
	return (
		<div
			data-slot="filter-bar-count"
			className={classes(
				"shrink-0 type-caption whitespace-nowrap text-text-2 data [unicode-bidi:plaintext]",
				className,
			)}
			{...props}
		>
			<span aria-hidden>
				{shown === total ? (
					<>
						<span className="tone-content-primary">{f(total)}</span> {noun}
					</>
				) : (
					<>
						<span className="tone-content-primary">{f(shown)}</span> of{" "}
						{f(total)}
						{noun ? ` ${noun}` : ""}
					</>
				)}
			</span>
			<output className="sr-only">{said}</output>
		</div>
	);
}

// ---------- Select ----------

type FilterOption = {
	value: string;
	label: string;
	/** How many rows this option leaves, against the other filters. From useFilteredRows. */
	count?: number;
	disabled?: boolean;
};

type FilterBarSelectBase = {
	/** The filter's name, on the chip and in the accessible name: "Status". */
	label: string;
	options: FilterOption[];
	/** An "All" row at the top that clears the filter. */
	showAllOption?: boolean;
	allLabel?: string;
	/** Sink options whose count is 0 below a rule. On when any option has a count. */
	sinkEmpty?: boolean;
	/** Show the choice on the chip ("Status: Failed", or a count). Off when applied-filter chips already show it. */
	showValue?: boolean;
	disabled?: boolean;
	className?: string;
	/** Opens with the menu open, for a still picture. */
	defaultOpen?: boolean;
};
type FilterBarSelectSingle = FilterBarSelectBase & {
	multiple?: false;
	value?: string | null;
	defaultValue?: string | null;
	onValueChange?: (value: string | null) => void;
};
type FilterBarSelectMultiple = FilterBarSelectBase & {
	multiple: true;
	value?: string[];
	defaultValue?: string[];
	onValueChange?: (value: string[]) => void;
};
type FilterBarSelectProps = FilterBarSelectSingle | FilterBarSelectMultiple;

const ALL = "__all__";
const optionText = (o: FilterOption) => o.label;

function useControllable<T>(
	value: T | undefined,
	defaultValue: T,
	onChange?: (v: T) => void,
) {
	const [inner, setInner] = React.useState<T>(defaultValue);
	const controlled = value !== undefined;
	const current = controlled ? value : inner;
	const set = (v: T) => {
		if (!controlled) setInner(v);
		onChange?.(v);
	};
	return [current, set] as const;
}

/** The chip a filter menu opens from: the toolbar control's look, pressed while its value differs from its default, with a caret. */
const chipTriggerClass = classes(
	"[&_[data-slot=chip-caret]]:transition-transform [&_[data-slot=chip-caret]]:duration-(--dur-state) data-popup-open:[&_[data-slot=chip-caret]]:rotate-180",
);

/**
 * A filter on a chip that opens a menu. It names the filter while nothing is chosen ("Status"), shows the choice once
 * one is ("Status: Failed", or a count for several), and sits pressed while it narrows the list. Single uses radio rows
 * and closes on a pick; multiple uses checkbox rows and stays open.
 */
function FilterBarSelect(props: FilterBarSelectProps) {
	const {
		label,
		options,
		showAllOption = false,
		allLabel = "All",
		disabled,
		className,
		showValue = true,
		defaultOpen,
	} = props;
	const [single, setSingle] = useControllable<string | null>(
		props.multiple ? undefined : props.value,
		props.multiple ? null : (props.defaultValue ?? null),
		props.multiple ? undefined : props.onValueChange,
	);
	const [many, setMany] = useControllable<string[]>(
		props.multiple ? props.value : undefined,
		props.multiple ? (props.defaultValue ?? []) : [],
		props.multiple ? props.onValueChange : undefined,
	);

	const chosen = props.multiple ? many : single ? [single] : [];
	const fallback = props.multiple
		? (props.defaultValue ?? [])
		: props.defaultValue
			? [props.defaultValue]
			: [];
	const active =
		chosen.length !== fallback.length ||
		chosen.some((v) => !fallback.includes(v));
	const first = options.find((o) => o.value === chosen[0]);
	const summary =
		chosen.length === 0 || !showValue
			? null
			: chosen.length > 1
				? null
				: first
					? optionText(first)
					: null;
	const accessibleName = `${label}: ${
		chosen.length === 0
			? allLabel
			: options
					.filter((o) => chosen.includes(o.value))
					.map(optionText)
					.join(", ")
	}`;

	const sink = props.sinkEmpty ?? options.some((o) => o.count !== undefined);
	const live = sink
		? options.filter((o) => o.count !== 0 || chosen.includes(o.value))
		: options;
	const empty = sink
		? options.filter((o) => o.count === 0 && !chosen.includes(o.value))
		: [];

	const optionsFor = (values: FilterOption[], isEmpty = false): MenuEntry[] =>
		values.map((option) =>
			props.multiple
				? {
						type: "checkbox" as const,
						value: option.value,
						label: option.label,
						metadata: option.count?.toLocaleString("en-US"),
						disabled: option.disabled || isEmpty,
						checked: many.includes(option.value),
						onCheckedChange: (checked) =>
							setMany(
								checked
									? [...many, option.value]
									: many.filter((value) => value !== option.value),
							),
					}
				: {
						type: "radio-group" as const,
						closeOnSelect: true,
						valueKey: `${label}-${option.value}`,
						value: single ?? ALL,
						options: [
							{
								value: option.value,
								label: option.label,
								metadata: option.count?.toLocaleString("en-US"),
								disabled: option.disabled || isEmpty,
							},
						],
						onValueChange: (value) => setSingle(value === ALL ? null : value),
					},
		);

	const items: MenuEntry[] = [];
	if (showAllOption) {
		if (props.multiple) {
			items.push({
				type: "checkbox",
				value: ALL,
				label: allLabel,
				checked: !active,
				onCheckedChange: () => setMany([]),
			});
		} else {
			items.push({
				type: "radio-group",
				closeOnSelect: true,
				valueKey: `${label}-all`,
				value: single ?? ALL,
				options: [{ value: ALL, label: allLabel }],
				onValueChange: () => setSingle(null),
			});
		}
		items.push({ type: "separator", value: `${label}-all-separator` });
	}
	if (props.multiple) {
		items.push(...optionsFor(live));
	} else {
		items.push({
			type: "radio-group",
			closeOnSelect: true,
			valueKey: label,
			value: single ?? ALL,
			options: live.map((option) => ({
				value: option.value,
				label: option.label,
				metadata: option.count?.toLocaleString("en-US"),
				disabled: option.disabled,
			})),
			onValueChange: (value) => setSingle(value === ALL ? null : value),
		});
	}
	if (empty.length > 0) {
		items.push(
			{ type: "separator", value: `${label}-empty-separator` },
			...optionsFor(empty, true),
		);
	}

	return (
		<Menu
			ariaLabel={accessibleName}
			defaultOpen={defaultOpen}
			items={items}
			trigger={
				<button
					type="button"
					disabled={disabled}
					aria-label={accessibleName}
					data-filter-bar-control="select"
					data-slot="filter-bar-select"
					data-filter={label}
					data-active={active || undefined}
					className={classes(chipTriggerClass, className)}
				>
					<span className="min-w-0 truncate">
						{summary != null ? (
							<>
								<span className="tone-content-secondary">{label}:</span>{" "}
								{summary}
							</>
						) : (
							label
						)}
					</span>
					{showValue && props.multiple && chosen.length > 1 && (
						<span className="data tone-content-secondary">{chosen.length}</span>
					)}
					<span data-slot="chip-caret">
						<CaretIcon />
					</span>
				</button>
			}
		/>
	);
}

// ---------- Facets ----------

type FacetField<T> = {
	/** The filter id: the key in `filters` and in the returned counts. */
	id: string;
	/** The row's value or values for this field. */
	value: (row: T) => readonly string[];
};

/**
 * Filters rows by a search and multi-value filters, and counts, for every option of
 * every field, how many rows it would leave given the search, the toggles and the other filters.
 */
function useFilteredRows<T>(
	rows: readonly T[],
	{
		search = "",
		match,
		fields,
		filters,
	}: {
		search?: string;
		/** Whether a row matches the lower-cased search. */
		match?: (row: T, query: string) => boolean;
		fields: FacetField<T>[];
		/** Field id to chosen values. An empty list or a missing field filters nothing. */
		filters: Record<string, readonly string[] | null | undefined>;
	},
) {
	return React.useMemo(() => {
		const q = search.trim().toLowerCase();
		const passes = (f: FacetField<T>, row: T) => {
			const chosen = filters[f.id];
			return !chosen?.length || f.value(row).some((v) => chosen.includes(v));
		};
		const counts: Record<string, Record<string, number>> = Object.fromEntries(
			fields.map((f) => [f.id, {}]),
		);
		const out: T[] = [];
		for (const row of rows) {
			if (q && match && !match(row, q)) continue;
			const pass = fields.map((f) => passes(f, row));
			if (pass.every(Boolean)) out.push(row);
			fields.forEach((f, i) => {
				// A row counts toward this field's options when it passes every other field.
				if (!pass.every((p, j) => j === i || p)) return;
				for (const v of f.value(row))
					counts[f.id][v] = (counts[f.id][v] ?? 0) + 1;
			});
		}
		return { rows: out, counts };
	}, [rows, search, match, fields, filters]);
}

export {
	FilterBar,
	FilterBarSearch,
	FilterToggle,
	FilterBarSelect,
	FilterBarButton,
	FilterBarClear,
	FilterBarCount,
	useFilteredRows,
	type FilterBarSearchProps,
	type FilterBarButtonProps,
	type FilterBarSelectProps,
	type FilterOption,
	type FacetField,
};
