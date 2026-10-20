import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '#/lib/glaze/utils.ts';

// Label and value pairs for a detail view: a run, a key, a prompt release. A real <dl> with each pair in a <div>, which
// HTML allows, inside a box that measures its own width. className goes on that box; every other prop on the <dl>.
//
// Side by side, every pair is a subgrid row of one grid: the label column is as wide as the longest label and no wider
// than --label-col (160px), so the values start on one edge without a fixed gutter wasting room beside "ID". Under 24rem of its own
// width the list stacks each label over its value, so it works in a 320px column and on a page.
//
// variant="panel" puts the list in the card's white panel, the pairs split on rule-row; plain is for inside a card or
// another panel, which is already the surface. An empty value (null, undefined or "") reads "None" in text-2, so a
// missing field never looks like a bug.

const dataListVariants = cva('group/data-list @container/data-list min-w-0', {
  variants: {
    variant: {
      plain: '',
      panel: 'panel px-3 forced-colors:border-[CanvasText]',
    },
  },
  defaultVariants: {variant: 'plain'},
});

type DataListProps = React.ComponentProps<'dl'> & VariantProps<typeof dataListVariants> & {
  /** horizontal: label beside value, stacking under 24rem. vertical: always stacked. */
  orientation?: 'horizontal' | 'vertical';
};

function DataList({className, variant = 'plain', orientation = 'horizontal', ...props}: DataListProps) {
  return <div data-slot="data-list-frame" data-variant={variant} data-orientation={orientation} className={cn(dataListVariants({variant}), className)}>
    <dl
      data-slot="data-list"
      className={cn('grid min-w-0 grid-cols-1', orientation === 'horizontal' && '@sm/data-list:grid-cols-[fit-content(var(--label-col))_minmax(0,1fr)] @sm/data-list:gap-x-4')}
      {...props}
    />
  </div>;
}

function DataListItem({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="data-list-item"
    className={cn(
      'col-span-full flex min-h-(--row) min-w-0 flex-col justify-center gap-x-4 gap-y-0.5 py-2',
      'group-data-[orientation=horizontal]/data-list:@sm/data-list:grid group-data-[orientation=horizontal]/data-list:@sm/data-list:grid-cols-subgrid group-data-[orientation=horizontal]/data-list:@sm/data-list:items-baseline',
      'group-data-[variant=panel]/data-list:rule-row',
      className,
    )}
    {...props}
  />;
}

/** The field's name, in text-2. */
function DataListLabel({className, ...props}: React.ComponentProps<'dt'>) {
  return <dt data-slot="data-list-label" className={cn('min-w-0 type-body-sm text-text-2 [overflow-wrap:anywhere]', className)} {...props}/>;
}

const isEmpty = (node: React.ReactNode) => node === null || node === undefined || node === false || (typeof node === 'string' && node.trim() === '');

type DataListValueProps = React.ComponentProps<'dd'> & {
  /** An ID, a key, a hash or a path, in mono at type-code-sm. */
  mono?: boolean;
};

/** The value, in text-1. Tabular figures always, so counts and times line up. */
function DataListValue({className, mono = false, children, ...props}: DataListValueProps) {
  const empty = isEmpty(children);
  return <dd
    data-slot="data-list-value"
    data-empty={empty || undefined}
    className={cn('flex min-w-0 flex-wrap items-center gap-2 text-text-1 data [overflow-wrap:anywhere]', mono && !empty ? 'type-code-sm' : 'type-label', className)}
    {...props}
  >{empty ? <DataListEmpty/> : children}</dd>;
}

/** What a field with no value says. DataListValue shows it by itself for an empty value. */
function DataListEmpty({className, children = 'None', ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="data-list-empty" className={cn('type-body-sm text-text-2', className)} {...props}>{children}</span>;
}

export {DataList, DataListItem, DataListLabel, DataListValue, DataListEmpty, dataListVariants, type DataListProps, type DataListValueProps};
