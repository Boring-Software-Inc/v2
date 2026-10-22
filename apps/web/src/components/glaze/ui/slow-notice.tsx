'use client';

import {createContext, useContext, useEffect, type ReactNode, type RefObject} from 'react';
import {Tooltip as TooltipPrimitive} from '@base-ui/react/tooltip';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {toast} from '#/components/glaze/ui/toast.tsx';
import {tooltipMotionClass, tooltipPopupClass} from '#/components/glaze/ui/tooltip.tsx';
import {useGlazePortal} from '#/lib/glaze/portal.ts';
import {slowVariant} from '#/lib/glaze/slow-variant.ts';
import {cn} from '#/lib/glaze/utils.ts';
import {createWaitStore, useMarkWaiting, useSlowAfter, useWaitRegion, type WaitStore} from '#/lib/glaze/waiting.ts';

const SLOW_NOTICE = 'This is taking abnormally long to process.';
const SLOW_TOAST_ID = 'slow-wait';

const BLUR_FADE = {
  initial: {opacity: 0, filter: 'blur(6px)'},
  animate: {opacity: 1, filter: 'blur(0px)'},
  exit: {opacity: 0, filter: 'blur(6px)'},
};

const slowToasts = createWaitStore();
let toastShown = false;
slowToasts.subscribe(() => {
  const waiting = slowToasts.waiting();
  if (waiting === toastShown) return;
  toastShown = waiting;
  if (waiting) toast(SLOW_NOTICE, {id: SLOW_TOAST_ID, timeout: 0});
  else toast.dismiss(SLOW_TOAST_ID);
});

function useSlowToast(show: boolean) {
  useEffect(() => (show ? slowToasts.mark() : undefined), [show]);
}

type SlowTextProps = {
  show: boolean;
  className?: string;
};

function SlowText({show, className}: SlowTextProps) {
  const reduced = useReducedMotion();
  return <AnimatePresence>
    {show && <motion.div
      key="slow"
      data-slot="slow-notice"
      role="status"
      {...BLUR_FADE}
      transition={reduced ? {duration: 0} : {duration: 0.28, ease: [0.22, 1, 0.36, 1]}}
      className={cn('pointer-events-none', className)}
    >
      <p className="type-body-sm text-text-2">{SLOW_NOTICE}</p>
    </motion.div>}
  </AnimatePresence>;
}

function useSlowRegion(active: boolean) {
  const slow = useSlowAfter(active);
  const variant = slow ? slowVariant().region : null;
  useSlowToast(variant === 'toast');
  return variant === 'inside';
}

function useSlowBehindContent(active: boolean) {
  useSlowToast(useSlowAfter(active));
}

const LoadRegionContext = createContext<WaitStore | null>(null);

type SlowRegionProps = {
  children: ReactNode;
  active?: boolean;
};

function SlowRegion({children, active = false}: SlowRegionProps) {
  const {store, waiting} = useWaitRegion();
  const inside = useSlowRegion(waiting);
  useSlowBehindContent(active && !waiting);
  return <LoadRegionContext.Provider value={store}>
    <SlowText show={inside} className="absolute inset-0 z-(--z-raised) grid place-items-center p-4 text-center"/>
    {children}
  </LoadRegionContext.Provider>;
}

function useLoadingMark() {
  useMarkWaiting(useContext(LoadRegionContext), true);
}

function useSlowButton(pending: boolean) {
  const slow = useSlowAfter(pending);
  const variant = slow ? slowVariant().button : null;
  useSlowToast(variant === 'toast');
  return variant;
}

function StillLabel({pendingLabel}: {pendingLabel: ReactNode}) {
  return <span data-slot="button-still" className="min-w-0 truncate">
    {pendingLabel ? <>Still <span className="inline-block first-letter:lowercase">{pendingLabel}</span></> : 'Still working'}
  </span>;
}

function SlowTooltip({open, anchor}: {open: boolean; anchor: RefObject<HTMLElement | null>}) {
  const container = useGlazePortal();
  return <TooltipPrimitive.Root open={open}>
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner anchor={anchor} side="inline-end" sideOffset={8} collisionPadding={8} className="isolate z-(--z-overlay)">
        <TooltipPrimitive.Popup data-slot="slow-notice" role="status" className={cn(tooltipPopupClass, tooltipMotionClass, 'pointer-events-none max-w-80 whitespace-nowrap')}>
          {SLOW_NOTICE}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}

export {
  SlowText,
  SlowRegion,
  SlowTooltip,
  LoadRegionContext,
  useLoadingMark,
  useSlowRegion,
  useSlowBehindContent,
  useSlowButton,
  StillLabel,
  SLOW_NOTICE,
  type SlowTextProps,
  type SlowRegionProps,
};
