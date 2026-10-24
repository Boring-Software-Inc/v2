'use client';

import * as React from 'react';
import {Icon, ArrowDown, ArrowUp, ChevronSort, More} from '#/components/glaze/icon.tsx';
import {useScrollTabStop} from '#/lib/glaze/data.ts';
import {cn} from '#/lib/glaze/utils.ts';
import {Button, type ButtonProps} from '#/components/glaze/ui/button.tsx';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '#/components/glaze/ui/dropdown-menu.tsx';
import {Empty, EmptyArt, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, type EmptyReason} from '#/components/glaze/ui/empty-state.tsx';
import {Skeleton} from '#/components/glaze/ui/skeleton.tsx';

// Glaze's table: records that share the same fields, in the card. The table sits in the grey shell with the white
// panel 3px in, so it reads as one thing on the page; frame="none" drops both for a table inside a Card's flush
// content. Inside the panel, an optional head row (title, count, actions) over a hairline, then the table, then
// pagination or totals on the shell's footer row, under the panel, like every card footer.
//
// Rows are --row (36px), split by the faint row rule (a cell's bottom edge, so it holds under a sticky head); the last
// row drops it because the panel's edge is right below. Heads are 32px in the 12/500 label in text-2. A numeric column
// (numeric) right-aligns in tabular figures; an ID column (mono) is Glaze Mono through type-code-sm, 0.8 of the 13px
// cells. Hover is the hover wash; a selected row, and the one open row, take the pressed wash. Colour stays out of the
// rows: a failure is a Status word in its cell, never a red row.
//
// A sortable head is a plain button in the head: the label, then the arrow that says the direction, shown on hover
// and focus while unsorted. A numeric head puts the arrow before the label so the label stays over its numbers.
//
// The selection column is a Checkbox in the first head and cell: 16px, glass when ticked, the column 40px. Empty and
// loading are rows of the table, so the head stays and nothing jumps: TableEmpty sits top-left where the first row
// would be, and TableLoading draws still grey bars the shape of the cells.
//
// DataGrid (ui/data-grid.tsx) is the same look driven by TanStack Table; it reads the classes exported here.

type TableFrame = 'card' | 'none';

/** The head row inside the panel: title, count, then actions at the end, over a hairline. Shared with DataGrid. */
function TableTitle({title, count, actions, id, className}: {title: React.ReactNode; count?: React.ReactNode; actions?: React.ReactNode; id?: string; className?: string}) {
  return <div data-slot="table-title" className={cn('flex min-h-(--row) min-w-0 shrink-0 items-center gap-2 border-b border-line-faint ps-3 pe-1.5', className)}>
    <span id={id} className="min-w-0 truncate type-label text-text-1">{title}</span>
    {count != null && <span data-slot="table-count" className="shrink-0 type-label text-text-2 data">{count}</span>}
    {actions != null && <div data-slot="table-actions" className="ms-auto flex shrink-0 items-center gap-1">{actions}</div>}
  </div>;
}

/** A strip under the head row for filters and the columns menu, over a hairline. Shared with DataGrid. */
function TableToolbar({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="table-toolbar" className={cn('flex min-h-(--row) min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-line-faint px-1.5 py-1', className)} {...props}/>;
}

/** The card around a table: the shell, the panel holding the rows, and the footer row on the shell. Shared with DataGrid. */
function TableFrameBox({frame = 'card', footer, className, children, ...props}: React.ComponentProps<'div'> & {frame?: TableFrame; footer?: React.ReactNode}) {
  if (frame === 'none') return <div data-slot="table-frame" data-frame="none" className={cn('flex min-w-0 flex-col', className)} {...props}>
    {children}
    {footer != null && <div data-slot="table-footer-row" className="flex min-h-(--row) min-w-0 items-center gap-2 border-t border-line-faint px-3 type-caption text-text-2">{footer}</div>}
  </div>;
  return <div data-slot="table-frame" data-frame="card" className={cn('shell text-text-1 forced-colors:border-[CanvasText]', className)} {...props}>
    <div data-slot="table-panel" className="panel flex min-w-0 flex-col overflow-hidden forced-colors:border-[CanvasText]">{children}</div>
    {footer != null && <div data-slot="table-footer-row" className="shell-foot [&>:first-child]:me-auto">{footer}</div>}
  </div>;
}

type TableProps = Omit<React.ComponentProps<'table'>, 'title' | 'frame'> & {
  /** card: the shell and panel around the table, the default. none: the bare table, inside a Card's flush content. */
  frame?: TableFrame;
  /** The head row's title. With it, the table is named by the title unless aria-label is set. */
  title?: React.ReactNode;
  /** After the title, in tabular figures: "48", "3 of 12". */
  count?: React.ReactNode;
  /** At the end of the head row: size="icon-sm" ghost buttons, or one size="sm" secondary. */
  actions?: React.ReactNode;
  /** A strip under the head row for filters. */
  toolbar?: React.ReactNode;
  /** On the shell's footer row: pagination, totals. */
  footer?: React.ReactNode;
  /** Keep the head row at the top while the rows scroll. Needs maxHeight. */
  stickyHeader?: boolean;
  /** The rows' scroll box height, px or a CSS length. The head sticks inside it. */
  maxHeight?: number | string;
  /** Classes for the frame: width and placement go here. */
  frameClassName?: string;
  /** Classes for the scroll box. */
  containerClassName?: string;
  /** The scroll box joins the tab order while it scrolls. DataGrid turns it off when its rows take focus. */
  scrollFocus?: boolean;
};

function Table({className, frame = 'card', title, count, actions, toolbar, footer, stickyHeader = false, maxHeight, frameClassName, containerClassName, scrollFocus = true, ...props}: TableProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const tab = useScrollTabStop(box, scrollFocus);
  const titleId = React.useId();
  const name = props['aria-label'];
  const labelledBy = !name && title ? titleId : undefined;
  return <TableFrameBox frame={frame} footer={footer} className={frameClassName}>
    {title != null && <TableTitle id={titleId} title={title} count={count} actions={actions}/>}
    {toolbar != null && <TableToolbar>{toolbar}</TableToolbar>}
    <div
      ref={box}
      data-slot="table-container"
      data-sticky-header={stickyHeader || undefined}
      tabIndex={tab}
      role={tab === 0 && (name || labelledBy) ? 'region' : undefined}
      aria-label={tab === 0 && name ? name : undefined}
      aria-labelledby={tab === 0 ? labelledBy : undefined}
      className={cn('group/table relative w-full min-w-0 overflow-auto overscroll-x-contain focus-visible:focus-ring-inset', containerClassName)}
      // value-ok: the scroll box's height is the caller's, a number of px or any length, so it can only live inline.
      style={maxHeight !== undefined ? {maxHeight} : undefined}
    >
      <table data-slot="table" aria-labelledby={labelledBy} className={cn(tableClassName, className)} {...props}/>
    </div>
  </TableFrameBox>;
}

/** The table element: separate borders, so a cell's rule holds under a sticky head. Shared with DataGrid. */
const tableClassName = 'w-full caption-bottom border-separate border-spacing-0 text-start type-body-sm text-text-1';

function TableHeader({className, ...props}: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={className} {...props}/>;
}

/** The body: every row but the last carries the row rule on its cells. */
function TableBody({className, ...props}: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn(bodyClassName, className)} {...props}/>;
}

const bodyClassName = '[&>tr:not(:last-child)>td]:border-b [&>tr:not(:last-child)>td]:border-line-faint [&>tr:not(:last-child)>th]:border-b [&>tr:not(:last-child)>th]:border-line-faint';

function TableFooter({className, ...props}: React.ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={cn('type-label text-text-1 [&>tr>td]:border-t [&>tr>td]:border-line-faint', className)} {...props}/>;
}

/**
 * Hover, selected and open in one place, shared with DataGrid. Selected (a ticked checkbox) and open (the one row whose
 * details show) both take the pressed wash; hover is the lighter wash. Forced colors keep them with an outline.
 */
const rowClassName = cn(
  'group/row transition-colors duration-(--dur-state) ease-out',
  '[tbody>&]:hover:bg-hover-row has-aria-expanded:bg-hover-row',
  'data-selected:bg-pressed data-selected:hover:bg-pressed data-open:bg-pressed data-open:hover:bg-pressed',
  'forced-colors:data-selected:outline-1 forced-colors:data-selected:-outline-offset-1 forced-colors:data-selected:outline-[Highlight] forced-colors:data-open:outline-2 forced-colors:data-open:-outline-offset-2 forced-colors:data-open:outline-[Highlight]',
);

type TableRowProps = React.ComponentProps<'tr'> & {
  /** The row's checkbox is ticked: the pressed wash and aria-selected. */
  selected?: boolean;
  /** The one row whose details are open: the pressed wash and aria-current. */
  open?: boolean;
};

function TableRow({className, selected, open, ...props}: TableRowProps) {
  return <tr
    data-slot="table-row"
    data-selected={selected || undefined}
    data-open={open || undefined}
    aria-selected={selected === undefined ? undefined : selected}
    aria-current={open ? 'true' : undefined}
    className={cn(rowClassName, className)}
    {...props}
  />;
}

/** A head cell, shared with DataGrid: 32px, the 12/500 label in text-2, the row rule under it, sticky in a sticky table. */
const headClassName = cn(
  'h-8 border-b border-line-faint bg-paper px-3 text-start align-middle type-label-sm whitespace-nowrap text-text-2',
  '[&:has([role=checkbox])]:w-10 [&:has([role=checkbox])]:pe-0',
  'group-data-sticky-header/table:sticky group-data-sticky-header/table:top-0 group-data-sticky-header/table:z-(--z-raised)',
);

/** A body cell, shared with DataGrid: one --row tall, 12px in, text-1. */
const cellClassName = 'h-(--row) px-3 align-middle whitespace-nowrap text-text-1 [&:has([role=checkbox])]:pe-0';

type TableHeadProps = React.ComponentProps<'th'> & {
  /** A column of numbers: right-aligned. */
  numeric?: boolean;
  /** The column's sort: asc, desc or false. Set (even false) or with onSort, the head is a sort button. */
  sort?: 'asc' | 'desc' | false;
  /** Called when the head is pressed. Shift is passed so a caller can add a second sort. */
  onSort?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

function TableHead({className, numeric, sort, onSort, children, ...props}: TableHeadProps) {
  // A head with a sort, or a handler, is a sort button; a server page can show one by passing sort alone.
  const sortable = !!onSort || sort !== undefined;
  return <th
    data-slot="table-head"
    scope="col"
    aria-sort={sortable ? (sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none') : undefined}
    className={cn(headClassName, numeric && 'text-end', className)}
    {...props}
  >
    {sortable ? <TableSortButton sort={sort ?? false} numeric={numeric} onClick={onSort}>{children}</TableSortButton> : children}
  </th>;
}

/**
 * The sort button inside a head: the label and the arrow, -6px into the cell's padding so the label stays on the
 * column's edge. The arrow shows the direction; while unsorted, a quiet up-down mark shows on hover and focus.
 */
function TableSortButton({sort, numeric, className, children, ...props}: React.ComponentProps<'button'> & {sort: 'asc' | 'desc' | false; numeric?: boolean}) {
  const icon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ChevronSort;
  return <button
    type="button"
    data-slot="table-sort"
    data-sorted={sort || undefined}
    className={cn(
      'group/sort -mx-1.5 inline-flex h-(--control-sm) items-center gap-1 rounded-pill px-1.5 type-label-sm text-text-2',
      'transition-colors duration-(--dur-state) ease-out hover:bg-hover hover:text-text-1 data-sorted:text-text-1',
      numeric && 'flex-row-reverse',
      className,
    )}
    {...props}
  >
    <span className="whitespace-nowrap">{children}</span>
    <Icon icon={icon} size={12} className={cn('shrink-0', !sort && 'text-text-3 opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100 pointer-coarse:opacity-100')}/>
  </button>;
}

type TableCellProps = React.ComponentProps<'td'> & {
  /** A number: right-aligned, tabular figures. */
  numeric?: boolean;
  /** An ID, key or path: Glaze Mono through type-code-sm, 0.8 of the cells. */
  mono?: boolean;
};

function TableCell({className, numeric, mono, ...props}: TableCellProps) {
  return <td data-slot="table-cell" className={cn(cellClassName, numeric && 'text-end data', mono && 'type-code-sm', className)} {...props}/>;
}

function TableCaption({className, ...props}: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('border-t border-line-faint px-3 py-2 text-start type-caption text-text-2', className)} {...props}/>;
}

type TableEmptyProps = Omit<React.ComponentProps<'td'>, 'title'> & {
  /** How many columns the row spans: every column of the table. */
  colSpan: number;
  /** Why there are no rows: empty (nothing yet) or no-results (a filter matched nothing). */
  reason?: Extract<EmptyReason, 'empty' | 'no-results' | 'error'>;
  /** What is missing, as a sentence: "No runs match timeout". */
  title: React.ReactNode;
  /** One line: why, and what the action does. */
  description?: React.ReactNode;
  /** The one way out: clear the filter, start a run. */
  action?: React.ReactNode;
  art?: React.ReactNode;
};

/** The body's one row when it has no records: a plain, small Empty centred across the columns. */
function TableEmpty({colSpan, reason = 'empty', title, description, action, art = <EmptyArt size="compact"/>, className, ...props}: TableEmptyProps) {
  return <tr data-slot="table-empty">
    <td colSpan={colSpan} className={cn('p-0 whitespace-normal', className)} {...props}>
      <Empty variant="plain" size="sm" reason={reason} art={art}>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          {description != null && <EmptyDescription>{description}</EmptyDescription>}
        </EmptyHeader>
        {action != null && <EmptyContent>{action}</EmptyContent>}
      </Empty>
    </td>
  </tr>;
}

type TableLoadingProps = {
  /** Placeholder rows. */
  rows?: number;
  /** The table's columns, one bar each. A numeric column's bar sits at the end. */
  columns: number | {numeric?: boolean; checkbox?: boolean}[];
  /** Hold the rows' room but draw nothing: the first --wait-show of a load. */
  hidden?: boolean;
};

/** Still placeholder rows the shape of the cells: grey bars half a line tall, no sweep. Mark the table aria-busy. */
function TableLoading({rows = 5, columns, hidden}: TableLoadingProps) {
  const cols = typeof columns === 'number' ? Array.from({length: columns}, () => ({})) as {numeric?: boolean; checkbox?: boolean}[] : columns;
  const widths = ['w-3/4', 'w-1/2', 'w-2/3'];
  return <>{Array.from({length: rows}, (_, r) => <tr key={r} aria-hidden data-slot="table-loading-row" className={cn(hidden && 'invisible')}>
    {cols.map((col, c) => <td key={c} className={cn(cellClassName, col.checkbox && 'w-10 pe-0')}>
      <Skeleton className={cn('h-2 rounded-pill', col.checkbox ? 'size-4 rounded-tag' : col.numeric ? 'ms-auto w-1/3' : widths[(r + c) % 3])}/>
    </td>)}
  </tr>)}</>;
}

// ---------- Row actions ----------

const RowActionsContext = React.createContext<((open: boolean) => void) | null>(null);

type TableRowActionsProps = React.ComponentProps<'div'> & {
  /** Shown in the same place while the actions are hidden: "4m ago". */
  indicator?: React.ReactNode;
  /** false shows the actions all the time. */
  revealOnHover?: boolean;
};

/**
 * Actions at the end of a row that show on row hover or focus and stay while their menu is open. They fade, never
 * unmount, so Tab still reaches them. On a touch screen, where nothing hovers, they always show.
 */
function TableRowActions({indicator, revealOnHover = true, className, children, 'aria-label': ariaLabel = 'Row actions', ...props}: TableRowActionsProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const shown = menuOpen || !revealOnHover;
  return <RowActionsContext.Provider value={setMenuOpen}>
    <div data-slot="table-row-actions" data-open={shown || undefined} className={cn("group/actions grid shrink-0 items-center justify-items-end [grid-template-areas:'stack']", className)} {...props}>
      {indicator != null && <span className="[grid-area:stack] type-caption whitespace-nowrap text-text-2 transition-opacity duration-(--dur-state) group-hover/row:opacity-0 group-focus-within/row:opacity-0 group-data-open/actions:opacity-0 pointer-coarse:opacity-0">{indicator}</span>}
      <div role="group" aria-label={ariaLabel} className={cn('flex items-center gap-0.5 [grid-area:stack] transition-opacity duration-(--dur-state)', revealOnHover && 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-open/actions:opacity-100 pointer-coarse:opacity-100')}>{children}</div>
    </div>
  </RowActionsContext.Provider>;
}

/** One icon action in a row: a 26px ghost icon button. Name it with the row: "Retry run_8f2a". */
function TableRowAction({size = 'icon-sm', variant = 'ghost', ...props}: ButtonProps) {
  return <Button data-slot="table-row-action" variant={variant} size={size} {...props}/>;
}

/** The overflow menu at the end of a row. Keeps the actions shown while it is open. */
function TableRowActionsMenu({label, children, align = 'end'}: {label: string; children: React.ReactNode; align?: 'start' | 'end'}) {
  const setOpen = React.useContext(RowActionsContext);
  return <DropdownMenu onOpenChange={open => setOpen?.(open)}>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm"/>} aria-label={label} data-slot="table-row-actions-trigger" className="data-popup-open:bg-pressed">
      <Icon icon={More}/>
    </DropdownMenuTrigger>
    <DropdownMenuContent size="sm" align={align}>{children}</DropdownMenuContent>
  </DropdownMenu>;
}

const TableRowActionsItem = DropdownMenuItem;
const TableRowActionsSeparator = DropdownMenuSeparator;

export {
  Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, TableEmpty, TableLoading,
  TableTitle, TableToolbar, TableFrameBox, TableSortButton,
  TableRowActions, TableRowAction, TableRowActionsMenu, TableRowActionsItem, TableRowActionsSeparator,
  tableClassName, bodyClassName, rowClassName, headClassName, cellClassName,
  type TableProps, type TableRowProps, type TableHeadProps, type TableCellProps, type TableEmptyProps, type TableLoadingProps, type TableRowActionsProps, type TableFrame,
};
