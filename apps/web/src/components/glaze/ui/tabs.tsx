'use client';

import {createContext, useContext, useEffect, useMemo, useRef} from 'react';
import {Tabs as TabsPrimitive} from '@base-ui/react/tabs';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn, controlHeight, mergeClass, mergeRefs} from '#/lib/glaze/utils.ts';

// Panels of one view, on Base UI Tabs. One look: labels as pills on the surface they sit on, no track. The selected
// tab sits on a paper pill with the panel's hairline (--line-faint), in text-1; the others are text-2 and turn text-1
// under the pointer, with no wash. Never a darker grey on grey: the selection is the lightest thing in the row, the way a
// card's panel is. In dark the pill is the raised dark paper. Not glass: a tab is a place, and glass marks a value
// chosen inside a control (the segmented thumb, a ticked box). No track: a track would make it a segmented control,
// which changes how one set of data shows, where tabs swap whole panels.
//
// The paper pill is one element, Base UI's indicator, under the labels: it slides to the selected tab and takes its
// width in --dur-slide on the house ease-out, while the labels crossfade from text-2 to text-1. Reduced motion jumps.
//
// The list never wraps. When the tabs do not fit it scrolls sideways with no bar, and the selected tab scrolls itself
// into view when it changes, from a key, a click or the caller. 32px tall, 26 small. A count after a label takes
// TabsCount, in tabular figures.

type Size = 'sm' | 'default';
const ListContext = createContext<{size: Size}>({size: 'default'});

function Tabs({className, ...props}: Omit<TabsPrimitive.Root.Props, 'orientation'>) {
  return <TabsPrimitive.Root data-slot="tabs" className={mergeClass('flex max-w-full min-w-0 flex-col gap-3', className)} {...props}/>;
}

// 4px of room inside the scroller so the focus ring is never clipped; the block margin takes the height back.
const tabsListVariants = cva(
  'relative -my-1 flex w-fit max-w-full min-w-0 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
  {
    variants: {size: {sm: '', default: ''}},
    defaultVariants: {size: 'default'},
  },
);

type TabsListProps = TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>;

function TabsList({className, size = 'default', children, ref, ...props}: TabsListProps) {
  const list = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => mergeRefs(list, ref), [ref]);
  const s = size ?? 'default';

  // Keep the selected tab in view, on mount and whenever it changes.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const show = () => {
      const tab = el.querySelector<HTMLElement>('[data-slot=tabs-trigger][data-active]');
      if (!tab) return;
      const box = el.getBoundingClientRect(), t = tab.getBoundingClientRect();
      if (t.left < box.left) el.scrollBy({left: t.left - box.left});
      else if (t.right > box.right) el.scrollBy({left: t.right - box.right});
    };
    show();
    const mo = new MutationObserver(records => { if (records.some(r => (r.target as HTMLElement).hasAttribute('data-active'))) show(); });
    mo.observe(el, {subtree: true, attributes: true, attributeFilter: ['data-active']});
    return () => mo.disconnect();
  }, []);

  const ctx = useMemo(() => ({size: s}), [s]);
  return <ListContext.Provider value={ctx}>
    <TabsPrimitive.List
      ref={refs}
      data-slot="tabs-list"
      data-size={s}
      className={mergeClass(tabsListVariants({size: s}), className)}
      {...props}
    >
      {/* The paper pill under the selected label. First, so the labels paint over it. */}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        renderBeforeHydration
        className={cn(
          'pointer-events-none absolute top-(--active-tab-top) left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left)',
          'rounded-pill border border-line-faint bg-paper',
          'transition-[translate,width] duration-(--dur-slide) ease-out motion-reduce:transition-none',
          'forced-colors:border-[Highlight] forced-colors:bg-[Highlight]',
        )}
      />
      {children}
    </TabsPrimitive.List>
  </ListContext.Provider>;
}

const triggerBase = [
  'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-pill border border-transparent whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent]',
  'text-text-2 transition-[color,background-color] duration-(--dur-slide) ease-out motion-reduce:transition-none',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  'data-disabled:cursor-not-allowed data-disabled:text-text-disabled forced-colors:data-disabled:text-[GrayText]',
].join(' ');

const triggerSize: Record<Size, string> = {
  sm: `${controlHeight.sm} px-2.5 type-label-sm [&_svg]:size-(--icon-sm)`,
  default: `${controlHeight.default} px-3 type-label [&_svg]:size-(--icon)`,
};

// Selected: text-1 over the sliding paper pill. While the pill is still hidden (no layout yet, or no script) the
// selected tab draws the paper and hairline itself, so the choice shows from the first paint. The rest turn text-1
// under the pointer and take no wash: a grey wash on the grey a tab row often sits on is the darker grey on grey.
const on = cn(
  'text-text-1 forced-colors:[forced-color-adjust:none] forced-colors:text-[HighlightText]',
  'in-[[data-slot=tabs-list]:has(>[data-slot=tabs-indicator][hidden])]:border-line-faint in-[[data-slot=tabs-list]:has(>[data-slot=tabs-indicator][hidden])]:bg-paper',
);
const off = 'hover:not-data-disabled:text-text-1';

function TabsTrigger({className, ...props}: TabsPrimitive.Tab.Props) {
  const {size} = useContext(ListContext);
  const base = cn(triggerBase, triggerSize[size]);
  return <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={state => cn(base, state.active ? on : off, typeof className === 'function' ? className(state) : className)}
    {...props}
  />;
}

function TabsContent({className, ...props}: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel
    data-slot="tabs-content"
    className={mergeClass('min-w-0 flex-1 rounded-tag type-body-sm text-text-1', className)}
    {...props}
  />;
}

/** How many things a tab's panel holds, after its label, in tabular figures at the label's weight. */
function TabsCount({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="tabs-count" className={cn('data opacity-70', className)} {...props}/>;
}

export {Tabs, TabsList, TabsTrigger, TabsContent, TabsCount, tabsListVariants, type TabsListProps};
