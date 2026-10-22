'use client';

import {createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Radio as RadioPrimitive} from '@base-ui/react/radio';
import {RadioGroup as RadioGroupPrimitive} from '@base-ui/react/radio-group';
import {Toggle as TogglePrimitive} from '@base-ui/react/toggle';
import {ToggleGroup as ToggleGroupPrimitive} from '@base-ui/react/toggle-group';
import {cva, type VariantProps} from 'class-variance-authority';
import {toolbarControlSurface} from '#/lib/glaze/control.ts';
import {cn, controlHeight} from '#/lib/glaze/utils.ts';

// Glaze's segmented control: two to five views of the same thing, on a paper pill track with the panel's hairline
// (--line-faint) and 2px of room inside it, the card's own surface, so it is never a darker grey on the grey it often sits on. The selected segment sits on the thumb, small glaze (glaze-sm), the press recipe drawn for small parts, so
// the chosen view reads as the pressed key it is. The others are plain text-2 labels that turn text-1 under the
// pointer. 32px tall; sm is 26px on the toolbar control's line and paper, with a flat pressed thumb, to sit in a filter bar.
//
// single has one thumb, a span under the segments that slides to the chosen one: it moves (translate) and takes the
// new segment's width in --dur-slide on the house ease-out, while the labels crossfade between text-2 and the glaze's
// glyph colour. Reduced motion jumps. Until the thumb has measured (the server render, the first paint) the chosen
// segment draws the glaze itself, so nothing flashes.
//
// single (the default) picks one, on Base UI's RadioGroup: the arrow keys move and select, Tab leaves. A radio cannot
// be cleared back to none, so pass value or defaultValue. multiple turns any number on, on Base UI's ToggleGroup with
// aria-pressed, for filters such as errors and warnings shown together; there each pressed segment is a thumb.
//
// A segment can carry a count of what its view holds, in tabular figures after the label, read to a screen reader as
// the segment's description so its name stays "Errors" while the number ticks. The count's slot reserves the widest
// value it has shown, or countMax, so a live count that goes from 99 to 100 never moves the segments.
//
// A label too long for its segment ends in an ellipsis and gets its full text as a title.

// The track takes its items' type role, so the height's 1lh is the label's line and not the page's.
const segmentedVariants = cva('inline-flex w-fit max-w-full shrink-0 items-stretch gap-0.5 rounded-pill border p-0.5', {
  variants: {
    fill: {
      true: 'flex w-full *:flex-1',
      false: '',
    },
    size: {
      default: `border-line-faint bg-paper forced-colors:border-[CanvasText] ${controlHeight.default} type-label`,
      sm: `${toolbarControlSurface} ${controlHeight.sm} type-label-sm`,
    },
  },
  defaultVariants: {fill: false, size: 'default'},
});

type SegmentedSize = 'default' | 'sm';
type Mode = {countMax?: number; multiple: boolean; sliding?: boolean; size: SegmentedSize};
const ModeContext = createContext<Mode>({multiple: false, size: 'default'});

/**
 * The sliding thumb: measures the chosen segment and writes its place and width to --seg-x and --seg-w on the track.
 * It measures again when the choice changes and when the track or a segment resizes (a font arriving, a count
 * growing). Returns whether it has measured, so the chosen segment can draw the glaze itself until then.
 */
function useThumb() {
  const track = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLSpanElement | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = track.current, th = thumb.current;
    if (!el || !th) return;
    let first = true;
    const place = () => {
      const on = el.querySelector<HTMLElement>(':scope > [data-slot=segmented-control-item][data-checked]');
      th.hidden = !on;
      if (!on) return;
      // The first place is set with the move off, so the thumb starts under the chosen segment instead of gliding in.
      if (first) th.style.transition = 'none';
      el.style.setProperty('--seg-x', `${on.offsetLeft}px`);
      el.style.setProperty('--seg-w', `${on.offsetWidth}px`);
      th.toggleAttribute('data-disabled', on.hasAttribute('data-disabled'));
      if (first) { void th.offsetWidth; th.style.transition = ''; first = false; }
    };
    place();
    setReady(true);
    const mo = new MutationObserver(place);
    mo.observe(el, {subtree: true, attributes: true, attributeFilter: ['data-checked', 'data-disabled']});
    const ro = new ResizeObserver(place);
    ro.observe(el);
    el.querySelectorAll(':scope > [data-slot=segmented-control-item]').forEach(item => ro.observe(item));
    return () => { mo.disconnect(); ro.disconnect(); };
  }, []);
  return {track, thumb, ready};
}

type Common = VariantProps<typeof segmentedVariants> & {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  /** Names the control when no visible label points at it. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** The widest count any segment is expected to show. Its width is reserved, so counts never move the segments. */
  countMax?: number;
};

type SingleProps = Common & Omit<RadioGroupPrimitive.Props, 'value' | 'defaultValue' | 'onValueChange' | 'className' | 'children'> & {
  multiple?: false;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type MultipleProps = Common & Omit<ToggleGroupPrimitive.Props, 'value' | 'defaultValue' | 'onValueChange' | 'className' | 'children' | 'multiple'> & {
  /** Any number of segments on, none included. */
  multiple: true;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

type SegmentedControlProps = SingleProps | MultipleProps;

function SegmentedControl(props: SegmentedControlProps) {
  const {className, fill = false, size = 'default', children} = props;
  const classes = cn(segmentedVariants({fill, size}), className);
  const {track, thumb, ready} = useThumb();
  const ctx: Mode = {countMax: props.countMax, multiple: !!props.multiple, sliding: ready, size: size ?? 'default'};
  if (props.multiple) {
    const {multiple: _m, onValueChange, fill: _f, size: _s, className: _c, children: _ch, countMax: _cm, ...rest} = props;
    return <ToggleGroupPrimitive data-slot="segmented-control" data-multiple="" multiple onValueChange={value => onValueChange?.(value as string[])} className={classes} {...rest}>
      <ModeContext.Provider value={ctx}>{children}</ModeContext.Provider>
    </ToggleGroupPrimitive>;
  }
  const {multiple: _m, onValueChange, fill: _f, size: _s, className: _c, children: _ch, countMax: _cm, ...rest} = props;
  return <RadioGroupPrimitive ref={track} data-slot="segmented-control" onValueChange={value => onValueChange?.(value as string)} className={cn('relative', classes)} {...rest}>
    <span
      ref={thumb}
      aria-hidden
      data-slot="segmented-control-thumb"
      className={cn(
        size === 'sm' ? 'bg-pressed' : 'glaze-sm',
        'pointer-events-none absolute inset-y-0.5 left-0 w-(--seg-w) translate-x-(--seg-x) rounded-pill',
        'transition-[translate,width] duration-(--dur-slide) ease-out motion-reduce:transition-none',
        !ready && 'invisible',
      )}
    />
    <ModeContext.Provider value={ctx}>{children}</ModeContext.Provider>
  </RadioGroupPrimitive>;
}

type SegmentedControlItemProps = {
  value: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  /** How many things the segment's view holds, in tabular figures after the label. */
  count?: number;
  /** The widest count this segment is expected to show; overrides the control's countMax. */
  countMax?: number;
  'aria-label'?: string;
};

const fmt = new Intl.NumberFormat('en-US');

const itemBase = [
  'relative inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-pill focus-sm border border-transparent whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent]',
  'transition-[color,background-color] duration-(--dur-slide) ease-out motion-reduce:transition-none',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  'data-disabled:cursor-not-allowed',
].join(' ');
const itemSize: Record<SegmentedSize, string> = {
  default: 'px-3 type-label [&_svg]:size-(--icon)',
  sm: 'px-2 type-label-sm [&_svg]:size-(--icon-sm)',
};
// The chosen segment: on its own small glaze (multiple, or before the sliding thumb has measured), or over the thumb.
const on = 'glaze-sm forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const onThumb = 'text-(--glaze-sm-text) data-disabled:text-text-disabled forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const onFlat = 'bg-pressed text-text-1 data-disabled:text-text-disabled forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const onFlatThumb = 'text-text-1 data-disabled:text-text-disabled forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const off = 'text-text-2 hover:not-data-disabled:text-text-1 active:not-data-disabled:bg-hover data-disabled:text-text-disabled forced-colors:data-disabled:text-[GrayText]';

function SegmentedControlItem({className, children, count, countMax: itemMax, ...props}: SegmentedControlItemProps) {
  const {countMax: groupMax, multiple, sliding, size} = useContext(ModeContext);
  const flat = size === 'sm';
  const countId = useId();
  // Without countMax, the slot keeps the widest count it has shown, so it never shrinks back and jitters.
  const seen = useRef(0);
  if (count !== undefined) seen.current = Math.max(seen.current, count);
  const reserve = itemMax ?? groupMax ?? seen.current;
  const title = typeof children === 'string' ? children : undefined;
  const content = <>
    <span data-slot="segmented-control-label" className="inline-flex min-w-0 items-center gap-1.5"><span className="min-w-0 truncate">{children}</span></span>
    {count !== undefined && <span data-slot="segmented-control-count" aria-hidden className="grid shrink-0 justify-items-start tabular-nums opacity-70 [grid-template-areas:'c']">
      <span className="invisible [grid-area:c]">{fmt.format(Math.max(reserve, count))}</span>
      <span id={countId} className="[grid-area:c]">{fmt.format(count)}</span>
    </span>}
  </>;
  const shared = {'data-slot': 'segmented-control-item', title, 'aria-describedby': count !== undefined ? countId : undefined};
  if (multiple) return <TogglePrimitive {...shared} {...props} className={state => cn(itemBase, itemSize[size], state.pressed ? (flat ? onFlat : on) : off, className)}>{content}</TogglePrimitive>;
  return <RadioPrimitive.Root {...shared} {...props} className={state => cn(itemBase, itemSize[size], state.checked ? (flat ? (sliding ? onFlatThumb : onFlat) : sliding ? onThumb : on) : off, className)}>{content}</RadioPrimitive.Root>;
}

export {SegmentedControl, SegmentedControlItem, segmentedVariants, type SegmentedControlProps, type SegmentedControlItemProps};
