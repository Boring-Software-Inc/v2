'use client';

import * as React from 'react';
import {createPortal} from 'react-dom';
import {Dialog, DialogContent, DialogDescription, DialogTitle, useDialogFootSlot} from '#/components/glaze/ui/dialog.tsx';
import {Icon, Search, Pending} from '#/components/glaze/icon.tsx';
import {cn, mergeRefs} from '#/lib/glaze/utils.ts';
import {menuItemClass, menuLabelClass, menuSeparatorClass} from '#/lib/glaze/overlay.ts';
import {SlowNotice} from '#/components/glaze/ui/slow-notice.tsx';
import {Kbd} from '#/components/glaze/ui/kbd.tsx';
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '#/components/glaze/ui/empty-state.tsx';

// Glaze's command list, the core of the ⌘K palette, with no extra dependency. The search is the surface's flat header
// row, with the group separator's hairline under it; the rows are the dropdown menu's rows; CommandDialog puts the list on Glaze's
// card, with the key hints on the shell's footer row. A search row over a list of grouped items; the input keeps focus while
// Up and Down move the active item, Home and End jump to the first and last when the field is empty
// (or with Ctrl, since in typed text they move the caret), and Enter runs it. Groups with nothing left
// hide, and Empty and Loading take the list's place. Whitespace alone is no search. The input is a
// combobox that points at the active option, so a screen reader follows along, and a polite status
// says how many results there are, counting the unavailable ones.
//
// Results rank by how they match, not by where they were written: a match at the start of the name
// first, then at the start of a word, then anywhere, then only in keywords. While searching,
// the groups dissolve (no headings) and every item sorts by its own rank, so the best match across the
// whole list is first and becomes the active item: Enter runs what the person most likely meant. Each option
// carries its position (aria-posinset) in that order, so a screen reader counts what is on screen. The
// letters that earned the match are drawn in ink with an underline while the rest of the label steps
// back to text-2, so the person sees why each result is there. Shortcuts are Kbd caps at the inline
// end. CommandDialog puts it all in a Dialog, a fifth of the way down the screen.

type Filter = (value: string, search: string, keywords?: string[]) => number;

const words = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean);

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 4 at the start of the name, 3 at the start of a word, 2 anywhere in it, 1 only in a keyword, 0 no match. */
function scoreWord(value: string, word: string, keywords: string[]) {
  const v = value.toLowerCase();
  const at = v.indexOf(word);
  if (at === 0) return 4;
  if (at > 0 && new RegExp(`(^|[\\s\\-_/.:])${escapeRe(word)}`).test(v)) return 3;
  if (at > 0) return 2;
  return keywords.some(k => k.toLowerCase().includes(word)) ? 1 : 0;
}

const defaultFilter: Filter = (value, search, keywords = []) => {
  let total = 0;
  for (const word of words(search)) {
    const score = scoreWord(value, word, keywords);
    if (!score) return 0;
    total += score;
  }
  return total;
};

/**
 * The ranges of `text` that the search's words match, merged, for drawing the matched letters. Each
 * word marks the occurrence that earned its score: at a word start when there is one, else the first.
 */
function matchRanges(text: string, search: string): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const word of words(search)) {
    const start = new RegExp(`(^|[\\s\\-_/.:])${escapeRe(word)}`).exec(lower);
    const at = start ? start.index + start[1].length : lower.indexOf(word);
    if (at >= 0) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

type CommandContextValue = {
  /** What the input holds. */
  search: string;
  /** The search trimmed: whitespace alone is no search. */
  query: string;
  setSearch: (search: string) => void;
  active: string | null;
  setActive: (id: string | null) => void;
  matches: (value: string, keywords?: string[]) => boolean;
  rank: (value: string, keywords?: string[]) => number;
  /** Items showing, unavailable ones included. */
  count: number;
  listId: string;
  /** The accessible name of the search field and the list. */
  label: string;
  loading: boolean;
  /** CommandLoading's words, said by the status while it is mounted. */
  setLoading: (loading: string | null) => void;
};

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommand() {
  const context = React.useContext(CommandContext);
  if (!context) throw new Error('Command parts must be inside <Command>.');
  return context;
}

const ITEM = '[data-slot="command-item"]';

type CommandProps = Omit<React.ComponentProps<'div'>, 'onKeyDown'> & {
  /** The accessible name of the search field and the results list. Not shown. */
  label?: string;
  /** Filter items by the search. Turn off when the results come from a server. */
  shouldFilter?: boolean;
  /** Scores an item: above 0 shows it. Defaults to every word of the search appearing in the value or keywords. */
  filter?: Filter;
  /** Wrap from the last item to the first and back. */
  loop?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
};

function Command({className, label = 'Commands', shouldFilter = true, filter = defaultFilter, loop = false, onKeyDown, children, ref, ...props}: CommandProps) {
  const [search, setSearch] = React.useState('');
  const [active, setActive] = React.useState<string | null>(null);
  const [count, setCount] = React.useState(0);
  const [unavailable, setUnavailable] = React.useState(0);
  const [loadingText, setLoading] = React.useState<string | null>(null);
  const loading = loadingText !== null;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const query = search.trim();

  const matches = React.useCallback(
    (value: string, keywords?: string[]) => !shouldFilter || !query || filter(value, query, keywords) > 0,
    [shouldFilter, query, filter],
  );
  const rank = React.useCallback(
    (value: string, keywords?: string[]) => (!shouldFilter || !query ? 0 : filter(value, query, keywords)),
    [shouldFilter, query, filter],
  );

  // Every showing item in the order the person sees it: by rank, ties in written order. With no search
  // every rank is 0, so this is the written order and the groups show as written. While searching the
  // groups dissolve (display: contents, no headings) and each item's CSS order is its rank, so the best
  // match across the whole list is first.
  const ordered = () => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(ITEM))
      .map((el, i) => ({el, i, r: Number(el.dataset.rank ?? 0)}))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .map(x => x.el);
  };
  const items = () => ordered().filter(el => el.getAttribute('aria-disabled') !== 'true');

  // After every render: order and count what is visible, number it for screen readers, and keep the
  // active item on something that exists. The first (best) item becomes active whenever the search
  // changes.
  const lastQuery = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const shown = ordered();
    shown.forEach((el, i) => { el.setAttribute('aria-posinset', String(i + 1)); el.setAttribute('aria-setsize', String(shown.length)); });
    const visible = shown.filter(el => el.getAttribute('aria-disabled') !== 'true');
    if (shown.length !== count) setCount(shown.length);
    if (shown.length - visible.length !== unavailable) setUnavailable(shown.length - visible.length);
    const queryChanged = lastQuery.current !== query;
    lastQuery.current = query;
    if (queryChanged || !visible.some(el => el.id === active)) {
      const first = visible[0]?.id ?? null;
      if (first !== active) setActive(first);
      rootRef.current?.querySelector('[data-slot="command-list"]')?.scrollTo({top: 0});
    }
  });

  const move = (to: (index: number, length: number) => number) => {
    const visible = items();
    if (!visible.length) return;
    const index = visible.findIndex(el => el.id === active);
    const next = visible[to(index, visible.length)];
    if (!next) return;
    setActive(next.id);
    next.scrollIntoView({block: 'nearest'});
  };

  // Home and End belong to the caret while there is text to move it through; with an empty field, or
  // with Ctrl or Cmd, they jump to the first and last item.
  const jumps = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const field = event.target instanceof HTMLInputElement ? event.target : null;
    return !field || !field.value || event.ctrlKey || event.metaKey;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const down = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n');
    const up = event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p');
    if (down) { event.preventDefault(); move((i, n) => i < 0 ? 0 : i + 1 < n ? i + 1 : loop ? 0 : i); }
    else if (up) { event.preventDefault(); move((i, n) => i <= 0 ? (loop ? n - 1 : 0) : i - 1); }
    else if ((event.key === 'Home' || event.key === 'End') && jumps(event)) { event.preventDefault(); move((_, n) => event.key === 'Home' ? 0 : n - 1); }
    else if (event.key === 'Enter') {
      const el = active ? document.getElementById(active) : null;
      if (el && el.getAttribute('aria-disabled') !== 'true') { event.preventDefault(); el.click(); }
    }
  };

  const value = React.useMemo<CommandContextValue>(
    () => ({search, query, setSearch, active, setActive, matches, rank, count, listId, label, loading, setLoading}),
    [search, query, active, matches, rank, count, listId, label, loading],
  );
  const rootSetRef = React.useMemo(() => mergeRefs(rootRef, ref), [ref]);
  const results = count === 1 ? '1 result' : `${count} results`;
  // One status for the whole command, outside the list: a listbox may only hold options and groups.
  const status = loading ? loadingText : !query ? '' : unavailable === 0 ? results : unavailable === count ? `${results}, unavailable` : `${results}, ${unavailable} unavailable`;

  return <CommandContext.Provider value={value}>
    <div
      ref={rootSetRef}
      data-slot="command"
      // Standalone it is the overlay surface: paper, the 1px ring, --radius-overlay. Inside CommandDialog the dialog's
      // panel is its surface, so it drops its own.
      className={cn(
        'relative flex size-full min-h-0 flex-col overflow-hidden rounded-overlay border border-line bg-paper text-text-1 [--menu-item-h:var(--menu-row)]',
        'in-data-[slot=command-dialog]:flex-1 in-data-[slot=command-dialog]:rounded-none in-data-[slot=command-dialog]:border-0 in-data-[slot=command-dialog]:bg-transparent',
        className,
      )}
      data-searching={query ? '' : undefined}
      {...props}
      onKeyDown={handleKeyDown}
    >
      {children}
      <p role="status" className="sr-only">{status}</p>
    </div>
  </CommandContext.Provider>;
}

type CommandDialogProps = Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  /** The hidden dialog title. null leaves it out, when the children render their own DialogTitle. */
  title?: React.ReactNode;
  /** The hidden dialog description. null leaves it out. */
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

/** The palette: a Command on the dialog's card, a fifth of the way down, with a hidden title for screen readers. */
function CommandDialog({title = 'Command palette', description = 'Search for a command to run', children, className, ...props}: CommandDialogProps) {
  return <Dialog {...props}>
    <DialogContent
      data-slot="command-dialog"
      size="lg"
      showCloseButton={false}
      className={cn('top-[20dvh] h-[min(calc(var(--row)*12),calc(80dvh-var(--space-8)))] translate-y-0', className)}
    >
      {title !== null && <DialogTitle className="sr-only">{title}</DialogTitle>}
      {description !== null && <DialogDescription className="sr-only">{description}</DialogDescription>}
      {children}
    </DialogContent>
  </Dialog>;
}

type CommandInputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

function CommandInput({className, value, onValueChange, placeholder = 'Search commands', ...props}: CommandInputProps) {
  const {search, setSearch, active, listId, label, loading} = useCommand();
  // A controlled value feeds the filter too.
  React.useEffect(() => { if (value !== undefined && value !== search) setSearch(value); }, [value, search, setSearch]);
  // The search is the surface's header row, not a field inside it: a pill (or any rounded box) nested 4px into the
  // 10px overlay never shares its corners. The row runs edge to edge, 36px above the --line-faint rule the groups use
  // (content-box, so the rule does not leave a 35px row with its centre on a half pixel). Its icon sits 12px in, on the
  // rows' icon column (the list's 4px plus a row's 8px). The input owns focus for the palette's whole life, so it draws
  // no ring; the caret and the active row show where you are. The text centres on its caps, like a field's.
  return <div
    data-slot="command-input-wrapper"
    className="box-content flex h-(--control-lg) shrink-0 items-center gap-2 border-b border-line-faint px-3 type-body-sm [&_svg]:size-(--icon) [&_svg]:shrink-0 [&_svg]:text-text-3"
  >
    {loading
      ? <Icon icon={Pending} className="animate-spin motion-reduce:animate-none"/>
      : <Icon icon={Search}/>}
    <input
      data-slot="command-input"
      data-control=""
      data-autofocus="always"
      role="combobox"
      aria-expanded
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={active ?? undefined}
      aria-label={label}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder={placeholder}
      value={value ?? search}
      onChange={event => { setSearch(event.target.value); onValueChange?.(event.target.value); }}
      className={cn('h-full min-w-0 flex-1 bg-transparent text-text-1 text-ellipsis outline-none placeholder:text-text-3', className)}
      {...props}
    />
  </div>;
}

function CommandList({className, ref, ...props}: Omit<React.ComponentProps<'div'>, 'id'>) {
  const {listId, label, count, loading} = useCommand();
  return <div
    ref={ref}
    // The search field points at this id (aria-controls), so a caller cannot replace it.
    id={listId}
    data-slot="command-list"
    // The input owns focus and points at the active option, so the scroller is no tab stop.
    tabIndex={-1}
    role="listbox"
    aria-label={label}
    aria-busy={loading || undefined}
    data-empty={count === 0 || undefined}
    // A flex column, so each item's CSS order (its rank) places it while searching.
    className={cn('flex max-h-(--popup-max) min-h-0 flex-1 flex-col scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain p-1 in-data-[slot=command-dialog]:max-h-none', className)}
    {...props}
  />;
}

/** Shown when nothing matches and nothing is loading: the message, then the query that found nothing. */
function CommandEmpty({className, children = 'No results', ...props}: React.ComponentProps<'div'>) {
  const {count, loading, query} = useCommand();
  if (count > 0 || loading) return null;
  // The list is a listbox, so the message is presentation; the command's status says it to a screen reader.
  // It is Glaze's empty state, plain and small, centred in the list.
  return <Empty data-slot="command-empty" role="presentation" reason="no-results" variant="plain" size="sm" className={className} {...props}>
    <EmptyHeader>
      <EmptyTitle role="presentation">{children}</EmptyTitle>
      {query && <EmptyDescription role="presentation" className="break-words">Nothing matches "{query}". Try fewer words.</EmptyDescription>}
    </EmptyHeader>
  </Empty>;
}

/**
 * Shown while results load. Mount it while fetching; it sets the list busy and spins the search icon.
 * Its words are said by the command's status, which sits outside the list, so this copy is hidden from
 * screen readers.
 */
function CommandLoading({className, children = 'Loading', ...props}: React.ComponentProps<'div'>) {
  const {setLoading} = useCommand();
  const said = typeof children === 'string' ? children : 'Loading';
  React.useLayoutEffect(() => { setLoading(said); return () => setLoading(null); }, [said, setLoading]);
  return <>
    <div data-slot="command-loading" aria-hidden className={cn('flex min-h-(--menu-item-h) items-center gap-2 px-2 type-label text-text-2', className)} {...props}>
      {children}
    </div>
    <SlowNotice active insetClassName="px-2 pb-2"/>
  </>;
}

function CommandGroup({className, heading, children, ...props}: React.ComponentProps<'div'> & {heading?: React.ReactNode}) {
  const headingId = React.useId();
  return <div
    data-slot="command-group"
    role="presentation"
    // A group with no visible items hides itself, heading and all.
    className={cn('[&:not(:has([data-slot=command-item]))]:hidden in-data-searching:[&:has([data-slot=command-item])]:contents', className)}
    {...props}
  >
    {heading && <div id={headingId} aria-hidden data-slot="command-group-heading" className={cn(menuLabelClass, 'in-data-searching:hidden')}>{heading}</div>}
    <div role="group" aria-labelledby={heading ? headingId : undefined} className="flex flex-col in-data-searching:contents">{children}</div>
  </div>;
}

/** A hairline between groups, drawn only: a listbox holds options and groups, so it is no separator to a screen reader. Hidden while searching unless alwaysRender. */
function CommandSeparator({className, alwaysRender, ...props}: React.ComponentProps<'div'> & {alwaysRender?: boolean}) {
  const {query} = useCommand();
  if (query && !alwaysRender) return null;
  return <div data-slot="command-separator" aria-hidden className={cn(menuSeparatorClass, className)} {...props}/>;
}

type CommandItemProps = Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  /** What the filter matches and onSelect receives. Defaults to the text content when it is a string. */
  value?: string;
  /** Extra words that should find this item: "remove" for Delete. */
  keywords?: string[];
  onSelect?: (value: string) => void;
  disabled?: boolean;
  /** Keep this item visible whatever the search. */
  forceMount?: boolean;
};

function CommandItem({className, value: valueProp, keywords, onSelect, disabled, forceMount, children, ...props}: CommandItemProps) {
  const {active, setActive, matches, rank} = useCommand();
  const id = React.useId();
  const value = valueProp ?? (typeof children === 'string' ? children : '');
  if (!forceMount && !matches(value, keywords)) return null;
  const selected = active === id;
  const score = rank(value, keywords);
  return <div
    id={id}
    data-slot="command-item"
    role="option"
    aria-selected={selected}
    aria-disabled={disabled || undefined}
    data-selected={selected || undefined}
    data-highlighted={selected || undefined}
    data-disabled={disabled || undefined}
    data-value={value}
    data-rank={score || undefined}
    style={score ? {order: -score} : undefined}
    onPointerMove={() => { if (!disabled && !selected) setActive(id); }}
    onClick={() => { if (!disabled) onSelect?.(value); }}
    className={cn(
      // The menu's row, with the active item standing in for the highlighted one: the list keeps focus in the input.
      'group/command-item scroll-my-1',
      menuItemClass,
      className,
    )}
    {...props}
  >{typeof children === 'string' ? <CommandLabel>{children}</CommandLabel> : children}</div>;
}

/**
 * An item's label with the matched letters drawn in ink. A string child of CommandItem gets one
 * automatically; wrap the text yourself when the item also holds an icon or a shortcut.
 */
function CommandLabel({children, className}: {children: string; className?: string}) {
  const {query} = useCommand();
  const ranges = query ? matchRanges(children, query) : [];
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(children.slice(at, from));
    parts.push(<mark key={i} className="bg-transparent text-text-1 underline decoration-1 underline-offset-2 forced-colors:text-[inherit]">{children.slice(from, to)}</mark>);
    at = to;
  });
  if (at < children.length) parts.push(children.slice(at));
  return <span data-slot="command-label" className={cn('min-w-0 truncate in-data-searching:text-text-2', className)}>{parts}</span>;
}

/** Keys, one cap per key, at the row's inline end: <CommandShortcut keys={['⌘', 'D']}/>. */
function CommandShortcut({className, keys, children, ...props}: React.ComponentProps<'kbd'> & {keys?: string[]}) {
  return <kbd data-slot="command-shortcut" className={cn('ms-auto flex shrink-0 items-center gap-1 ps-4', className)} {...props}>
    {keys ? keys.map((key, i) => <Kbd key={i}>{key}</Kbd>) : children}
  </kbd>;
}

/**
 * The hint row under the list: how to move, run and close. In CommandDialog it is the card's footer row on the shell,
 * caption text with key caps; it hides on a touch screen, where there are no keys to press.
 */
function CommandFooter({className, children, ...props}: React.ComponentProps<'div'>) {
  const slot = useDialogFootSlot();
  const row = <div data-slot="command-footer" className={cn('shell-foot gap-4 pointer-coarse:hidden', className)} {...props}>
    {children}
  </div>;
  // In CommandDialog the hints sit on the shell under the panel, as a dialog's footer does.
  if (slot === undefined) return row;
  return slot ? createPortal(row, slot) : null;
}

/** One hint in the footer: the keys, then what they do. */
function CommandHint({keys, children}: {keys: string[]; children: React.ReactNode}) {
  return <span data-slot="command-hint" className="inline-flex items-center gap-1.5">
    <span className="flex items-center gap-1">{keys.map((key, i) => <Kbd key={i}>{key}</Kbd>)}</span>
    {children}
  </span>;
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandLoading,
  CommandGroup,
  CommandItem,
  CommandLabel,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
  CommandHint,
  useCommand,
};
