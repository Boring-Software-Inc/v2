import {cn, controlHeight} from '#/lib/glaze/utils.ts';

export const toolbarControlShape = cn(
  controlHeight.sm,
  'inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-pill border whitespace-nowrap select-none',
  'type-label-sm [&_svg]:pointer-events-none [&_svg]:size-(--icon-sm) [&_svg]:shrink-0 [&_svg]:text-text-3',
);

export const toolbarControlSurface = 'border-line-control bg-paper text-text-1 forced-colors:border-[ButtonText]';

export const toolbarControlClass = cn(
  toolbarControlShape, toolbarControlSurface,
  'relative cursor-pointer px-2.5 focus-sm [-webkit-tap-highlight-color:transparent]',
  'transition-[background-color,border-color,color,scale] duration-(--dur-state) ease-out',
  'hover:not-data-disabled:border-line-focus data-popup-open:border-line-focus',
  'active:not-data-disabled:scale-(--scale-press) active:duration-(--dur-press)',
  'data-pressed:border-line-focus data-pressed:bg-pressed data-pressed:[&_svg]:text-text-1',
  'data-active:border-line-focus data-active:bg-pressed data-active:[&_svg]:text-text-1',
  'data-disabled:cursor-not-allowed data-disabled:border-line-faint data-disabled:bg-paper data-disabled:text-text-disabled',
  'forced-colors:data-pressed:border-2 forced-colors:data-active:border-2',
);

export const toolbarFieldClass = cn(
  toolbarControlShape, toolbarControlSurface,
  '[--input-h:var(--control-sm)] [--input-px:--spacing(2.5)] px-(--input-px)',
  '[&_[data-slot=input-leading]]:text-text-3 [&_kbd]:min-h-4 [&_kbd]:min-w-4',
);

export const toolbarFieldControlClass = 'type-label-sm placeholder:text-text-2';
