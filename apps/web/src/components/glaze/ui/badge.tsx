import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's badge: a short static label that names what something is (a model, an environment, "Beta") or how it
// stands (Passed, Slow, Failed). It is not pressed, so it is flat: no glass, no ring that reads as a control, and it
// takes the 6px tag corner, never the pill, so it never passes for a button beside one.
//
// neutral is the grey field with ink text, outline a 1px control line on nothing, for a label beside other grey.
// ok, warn and fail are the status tints with their word colour (5.0:1 or better on the tint), and only for status:
// green done, amber warning, coral failure, always with the word. Two sizes, 20px and 16px, both 12px type.
//
// count with max: past the cap it shows "99+" and keeps the exact number for screen readers and the title.

const badgeVariants = cva(
  [
    'inline-flex w-fit max-w-full shrink-0 items-center justify-center gap-1 overflow-hidden rounded-tag whitespace-nowrap data',
    '[&>svg]:pointer-events-none [&>svg]:size-(--icon-sm) [&>svg]:shrink-0',
    'forced-colors:border forced-colors:border-[CanvasText]',
  ],
  {
    variants: {
      variant: {
        neutral: 'bg-field text-text-1',
        outline: 'border border-line-control text-text-1',
        ok: 'bg-ok-tint text-ok-text',
        warn: 'bg-warn-tint text-warn-text',
        fail: 'bg-fail-tint text-fail-text',
      },
      size: {
        default: 'min-h-5 px-1.5 type-label-sm',
        sm: 'min-h-4 px-1 type-label-sm',
      },
    },
    defaultVariants: {variant: 'neutral', size: 'default'},
  },
);

type BadgeProps = useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & {
  /** A count in place of the label. With max, values past it show as "max+"; the exact number stays the accessible name. */
  count?: number;
  /** The cap for count. 99 by default. */
  max?: number;
};

function Badge({className, variant = 'neutral', size = 'default', count, max = 99, render, children, ...props}: BadgeProps) {
  const capped = count !== undefined && count > max;
  const exact = count?.toLocaleString('en-US');
  const shown = count === undefined ? children : capped ? <><span aria-hidden>{max}+</span><span className="sr-only">{exact}</span></> : exact;
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {className: cn(badgeVariants({variant, size}), className), children: shown},
      {'data-slot': 'badge', 'data-variant': variant, 'data-size': size, title: capped ? exact : undefined} as React.ComponentProps<'span'>,
      props,
    ),
    render,
    state: {slot: 'badge', variant},
  });
}

export {Badge, badgeVariants, type BadgeProps};
