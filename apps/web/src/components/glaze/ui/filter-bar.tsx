'use client';

import * as React from 'react';
import {Icon, Add, ChevronDown} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';
import {Button} from '#/components/glaze/ui/button.tsx';
import {Chip, ChipGroup, chipToggleClasses, chipVariants, type ChipProps} from '#/components/glaze/ui/chip.tsx';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '#/components/glaze/ui/dropdown-menu.tsx';
import {Input, type SearchModeProps} from '#/components/glaze/ui/input.tsx';

// Glaze's filter bar: the row above a list or a table that narrows it. One row of separate 26px controls, 8px apart:
// the search (Input's search mode, small; "/" focuses it from anywhere, Escape clears it), then the filters as chips.
// A filter with values (FilterBarSelect) is a chip with a caret that opens a menu; a quick filter (FilterToggle) is a
// Chip that sits pressed. A set filter takes the pressed chip's look, the wash and the darkened line: flat, never
// glass, because a row of filters has no lead. The count and Clear all keep the row's end; under 28rem the search
// takes its own row. Applied filters can go on a second row as removable chips (FilterBarChips, FilterChip).
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
function FilterBar({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    role="search"
    data-slot="filter-bar"
    className={cn(
      '@container flex w-full min-w-0 flex-wrap items-center gap-2',
      '[&>[data-slot=filter-bar-count]]:ms-auto [&>[data-slot=filter-bar-clear]]:ms-auto [&>[data-slot=filter-bar-count]~[data-slot=filter-bar-clear]]:ms-0',
      '@max-2xs:[&>[data-slot=filter-bar-count]]:sr-only @max-2xs:[&>[data-slot=filter-bar-count]~[data-slot=filter-bar-clear]]:ms-auto',
      className,
    )}
    {...props}
  />;
}

// ---------- Search ----------

type FilterBarSearchProps = Omit<SearchModeProps, 'mode' | 'value' | 'defaultValue' | 'onValueChange' | 'shortcut' | 'shortcutOwner'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** The key that focuses the search from anywhere outside a field, dialog or menu. null turns it off. */
  shortcut?: string | null;
};

/** The bar's search: Input's search mode at 26px, named by its placeholder, filling the row's spare width; its own row when the bar is narrow. */
function FilterBarSearch({shortcut = '/', placeholder = 'Search', size = 'sm', className, 'aria-label': ariaLabel, ...props}: FilterBarSearchProps) {
  return <Input
    mode="search"
    size={size}
    shortcut={shortcut ?? undefined}
    placeholder={placeholder}
    aria-label={ariaLabel ?? placeholder}
    aria-keyshortcuts={shortcut ?? undefined}
    className={cn('w-auto min-w-32 flex-1 basis-40 @max-md:basis-full', className)}
    {...props}
  />;
}

// ---------- Chips and toggles ----------

/** The applied filters on their own row, 4px apart; the scope removal moves focus within. */
function FilterBarChips(props: React.ComponentProps<'div'>) {
  return <ChipGroup data-filter-chips="" {...props}/>;
}

type FilterChipProps = {
  /** The field: "Status", "Agent". */
  label: string;
  /** The value: "Failed". Several read "Failed, Waiting". */
  value: React.ReactNode;
  onRemove: () => void;
  className?: string;
};

/**
 * An applied filter, "Status Failed", that the person can remove. Focus moves to the next chip; when the last goes,
 * it returns to the filter that set it, found by its data-filter label, instead of falling to the page.
 */
function FilterChip({label, value, onRemove, className}: FilterChipProps) {
  const remove = () => {
    let select: HTMLElement | null = null;
    for (let scope = (document.activeElement as HTMLElement | null)?.parentElement; scope && !select; scope = scope.parentElement) {
      select = scope.querySelector<HTMLElement>(`[data-slot=filter-bar-select][data-filter="${CSS.escape(label)}"]`);
    }
    onRemove();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      if (select?.isConnected) select.focus();
    }));
  };
  return <Chip onRemove={remove} removeLabel={`Remove ${label} filter`} data-filter={label} className={className}>
    <span className="text-text-2">{label}</span> {value}
  </Chip>;
}

/** A quick filter that sits pressed: "Failed only", "Mine". A Chip, so it reads like every other toggle. */
function FilterToggle(props: Extract<ChipProps, {onRemove?: undefined}>) {
  return <Chip data-filter-toggle="" {...props}/>;
}

/** Clears everything. Render it only while something is set; it hands focus to the search when it goes. */
function FilterBarClear({className, children = 'Clear all', onClick, ...props}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return <Button
    variant="ghost"
    size="sm"
    data-slot="filter-bar-clear"
    onClick={event => {
      const bar = (event.currentTarget as HTMLElement).closest('[data-slot=filter-bar]');
      onClick?.(event);
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        bar?.querySelector<HTMLElement>('[data-mode=search] [data-control], [data-slot=filter-bar-select]')?.focus();
      });
    }}
    className={cn('px-2 text-text-2', className)}
    {...props}
  >{children}</Button>;
}

/**
 * "128 of 1,204 runs". The visible count updates at once; the announcement waits for typing to pause for 500ms, so a
 * screen reader hears one count, not one per key.
 */
function FilterBarCount({shown, total, noun, className, ...props}: React.ComponentProps<'div'> & {shown: number; total: number; noun?: string}) {
  const f = (n: number) => n.toLocaleString('en-US');
  const text = shown === total ? `${f(total)}${noun ? ` ${noun}` : ''}` : `${f(shown)} of ${f(total)}${noun ? ` ${noun}` : ''}`;
  const [said, setSaid] = React.useState(text);
  React.useEffect(() => {
    const id = window.setTimeout(() => setSaid(text), 500);
    return () => window.clearTimeout(id);
  }, [text]);
  return <div data-slot="filter-bar-count" className={cn('shrink-0 type-caption whitespace-nowrap text-text-2 data [unicode-bidi:plaintext]', className)} {...props}>
    <span aria-hidden>{shown === total ? <><span className="text-text-1">{f(total)}</span> {noun}</> : <><span className="text-text-1">{f(shown)}</span> of {f(total)}{noun ? ` ${noun}` : ''}</>}</span>
    <span role="status" className="sr-only">{said}</span>
  </div>;
}

// ---------- Select ----------

type FilterOption = {
  value: string;
  label: React.ReactNode;
  /** Plain text for the chip and the accessible name when label is not a string. */
  textValue?: string;
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
type FilterBarSelectSingle = FilterBarSelectBase & {multiple?: false; value?: string | null; defaultValue?: string | null; onValueChange?: (value: string | null) => void};
type FilterBarSelectMultiple = FilterBarSelectBase & {multiple: true; value?: string[]; defaultValue?: string[]; onValueChange?: (value: string[]) => void};
type FilterBarSelectProps = FilterBarSelectSingle | FilterBarSelectMultiple;

const ALL = '__all__';
const optionText = (o: FilterOption) => o.textValue ?? (typeof o.label === 'string' ? o.label : o.value);

function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = React.useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = (v: T) => { if (!controlled) setInner(v); onChange?.(v); };
  return [current, set] as const;
}

/** The chip a filter menu opens from: the toggle chip's look, pressed while the filter is set, with a caret. */
const chipTriggerClass = cn(
  chipVariants(), chipToggleClasses, 'pe-2',
  'data-active:border-line-focus data-active:bg-pressed data-active:[&_svg]:text-text-1 data-popup-open:border-line-focus',
  '[&_[data-slot=chip-caret]]:transition-transform [&_[data-slot=chip-caret]]:duration-(--dur-state) data-popup-open:[&_[data-slot=chip-caret]]:rotate-180',
);

function OptionBody({option}: {option: FilterOption}) {
  return <>
    <span className="min-w-0 flex-1 truncate">{option.label}</span>
    {option.count !== undefined && <span data-slot="filter-option-count" className="ms-auto ps-3 type-caption data text-text-3">{option.count.toLocaleString('en-US')}</span>}
  </>;
}

/**
 * A filter on a chip that opens a menu. It names the filter while nothing is chosen ("Status"), shows the choice once
 * one is ("Status: Failed", or a count for several), and sits pressed while it narrows the list. Single uses radio rows
 * and closes on a pick; multiple uses checkbox rows and stays open.
 */
function FilterBarSelect(props: FilterBarSelectProps) {
  const {label, options, showAllOption = false, allLabel = 'All', disabled, className, showValue = true, defaultOpen} = props;
  const [single, setSingle] = useControllable<string | null>(props.multiple ? undefined : props.value, props.multiple ? null : props.defaultValue ?? null, props.multiple ? undefined : props.onValueChange);
  const [many, setMany] = useControllable<string[]>(props.multiple ? props.value : undefined, props.multiple ? props.defaultValue ?? [] : [], props.multiple ? props.onValueChange : undefined);

  const chosen = props.multiple ? many : single ? [single] : [];
  const active = chosen.length > 0;
  const first = options.find(o => o.value === chosen[0]);
  const summary = !active || !showValue ? null : chosen.length > 1 ? null : first ? optionText(first) : null;
  const accessibleName = `${label}: ${!active ? allLabel : options.filter(o => chosen.includes(o.value)).map(optionText).join(', ')}`;

  const sink = props.sinkEmpty ?? options.some(o => o.count !== undefined);
  const live = sink ? options.filter(o => o.count !== 0 || chosen.includes(o.value)) : options;
  const empty = sink ? options.filter(o => o.count === 0 && !chosen.includes(o.value)) : [];

  const row = (o: FilterOption, isEmpty = false) => props.multiple
    ? <DropdownMenuCheckboxItem
        key={o.value}
        data-slot="filter-option"
        disabled={o.disabled || isEmpty}
        checked={many.includes(o.value)}
        onCheckedChange={c => setMany(c ? [...many, o.value] : many.filter(v => v !== o.value))}
        closeOnClick={false}
      ><OptionBody option={o}/></DropdownMenuCheckboxItem>
    : <DropdownMenuRadioItem key={o.value} value={o.value} closeOnClick disabled={o.disabled || isEmpty} data-slot="filter-option"><OptionBody option={o}/></DropdownMenuRadioItem>;

  const sunk = empty.length > 0 && <>
    <DropdownMenuSeparator/>
    <DropdownMenuGroup>
      <DropdownMenuLabel inset>None left with the other filters</DropdownMenuLabel>
      {empty.map(o => row(o, true))}
    </DropdownMenuGroup>
  </>;

  return <DropdownMenu defaultOpen={defaultOpen} modal={defaultOpen ? false : undefined}>
    <DropdownMenuTrigger
      disabled={disabled}
      aria-label={accessibleName}
      data-slot="filter-bar-select"
      data-filter={label}
      data-active={active || undefined}
      className={cn(chipTriggerClass, className)}
    >
      <span className="min-w-0 truncate">{summary != null ? <><span className={cn(active && 'text-text-2')}>{label}:</span> {summary}</> : label}</span>
      {showValue && props.multiple && chosen.length > 1 && <span className="data text-text-2">{chosen.length}</span>}
      <Icon icon={ChevronDown} data-slot="chip-caret"/>
    </DropdownMenuTrigger>
    <DropdownMenuContent size="sm" className="max-w-[min(var(--available-width),var(--popover))]" finalFocus={defaultOpen ? false : undefined} collisionAvoidance={defaultOpen ? {side: 'none', align: 'none', fallbackAxisSide: 'none'} : undefined}>
      {props.multiple
        ? <>
            {showAllOption && <>
              <DropdownMenuCheckboxItem checked={!active} onCheckedChange={() => setMany([])} closeOnClick={false}>{allLabel}</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator/>
            </>}
            {live.map(o => row(o))}
            {sunk}
          </>
        : <DropdownMenuRadioGroup value={single ?? ALL} onValueChange={v => setSingle(v === ALL ? null : v as string)}>
            {showAllOption && <>
              <DropdownMenuRadioItem value={ALL} closeOnClick>{allLabel}</DropdownMenuRadioItem>
              <DropdownMenuSeparator/>
            </>}
            {live.map(o => row(o))}
            {sunk}
          </DropdownMenuRadioGroup>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

// ---------- Add filter ----------

type FilterBarAddProps = {
  /** The field: "Method". After a plus on the dashed chip, and before the value once set. */
  label: string;
  options: FilterOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * A filter that is not on yet: a chip with a dashed line and a plus, "+ Method". It opens a menu of values; a pick
 * turns it into the removable chip "Method: POST", and removing that brings the dashed chip back with focus on it.
 * One value per field; use FilterBarSelect for several.
 */
function FilterBarAdd({label, options, disabled, className, ...props}: FilterBarAddProps) {
  const [value, setValue] = useControllable<string | null>(props.value, props.defaultValue ?? null, props.onValueChange);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const chosen = options.find(o => o.value === value);
  if (chosen) return <Chip
    data-slot="filter-bar-add-value"
    data-filter={label}
    onRemove={() => setValue(null)}
    removeLabel={`Remove ${label} filter`}
    focusAfterEmpty={trigger}
    className={className}
  ><span className="text-text-2">{label}:</span> {optionText(chosen)}</Chip>;
  return <DropdownMenu>
    <DropdownMenuTrigger
      ref={trigger}
      disabled={disabled}
      aria-label={`Add ${label} filter`}
      data-slot="filter-bar-add"
      data-filter={label}
      className={cn(chipTriggerClass, 'border-dashed bg-transparent text-text-2 hover:not-data-disabled:text-text-1', className)}
    >
      <Icon icon={Add}/>{label}
    </DropdownMenuTrigger>
    <DropdownMenuContent size="sm" className="max-w-[min(var(--available-width),var(--popover))]">
      <DropdownMenuRadioGroup value={value ?? ''} onValueChange={v => setValue(v as string)}>
        {options.map(o => <DropdownMenuRadioItem key={o.value} value={o.value} closeOnClick disabled={o.disabled} data-slot="filter-option"><OptionBody option={o}/></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

// ---------- Facets ----------

type FacetField<T> = {
  /** The filter id: the key in `filters` and in the returned counts. */
  id: string;
  /** The row's value or values for this field. */
  value: (row: T) => string | readonly string[];
};

/**
 * Filters rows by a search, pressed toggles and any number of multi-value filters, and counts, for every option of
 * every field, how many rows it would leave given the search, the toggles and the other filters.
 */
function useFilteredRows<T>(rows: readonly T[], {search = '', match, fields, filters, where}: {
  search?: string;
  /** Pressed toggles as row tests. Pass a stable array (useMemo); falsy entries are off. */
  where?: readonly (((row: T) => boolean) | false | null | undefined)[];
  /** Whether a row matches the lower-cased search. */
  match?: (row: T, query: string) => boolean;
  fields: FacetField<T>[];
  /** Field id to chosen values. An empty list or a missing field filters nothing. */
  filters: Record<string, readonly string[] | null | undefined>;
}) {
  return React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const values = (f: FacetField<T>, row: T) => { const v = f.value(row); return typeof v === 'string' ? [v] : v; };
    const passes = (f: FacetField<T>, row: T) => { const chosen = filters[f.id]; return !chosen?.length || values(f, row).some(v => chosen.includes(v)); };
    const counts: Record<string, Record<string, number>> = Object.fromEntries(fields.map(f => [f.id, {}]));
    const out: T[] = [];
    const tests = (where ?? []).filter((t): t is (row: T) => boolean => typeof t === 'function');
    for (const row of rows) {
      if (q && match && !match(row, q)) continue;
      if (!tests.every(t => t(row))) continue;
      const pass = fields.map(f => passes(f, row));
      if (pass.every(Boolean)) out.push(row);
      fields.forEach((f, i) => {
        // A row counts toward this field's options when it passes every other field.
        if (!pass.every((p, j) => j === i || p)) return;
        for (const v of values(f, row)) counts[f.id][v] = (counts[f.id][v] ?? 0) + 1;
      });
    }
    return {rows: out, counts};
  }, [rows, search, match, fields, filters, where]);
}

export {
  FilterBar, FilterBarSearch, FilterBarChips, FilterChip, FilterToggle, FilterBarSelect, FilterBarAdd, FilterBarClear, FilterBarCount, useFilteredRows,
  type FilterBarSearchProps, type FilterBarAddProps, type FilterBarSelectProps, type FilterChipProps, type FilterOption, type FacetField,
};
