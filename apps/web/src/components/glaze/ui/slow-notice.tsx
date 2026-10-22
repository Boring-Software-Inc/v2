'use client';

import {createContext, useContext, type ReactNode} from 'react';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useMarkWaiting, useSlowAfter, useWaitRegion, type WaitStore} from '#/lib/glaze/waiting.ts';
import {cn} from '#/lib/glaze/utils.ts';

const SLOW_NOTICE = 'This is taking abnormally long to process.';

const BLUR_FADE = {
  initial: {opacity: 0, filter: 'blur(6px)', height: 0},
  animate: {opacity: 1, filter: 'blur(0px)', height: 'auto'},
  exit: {opacity: 0, filter: 'blur(6px)', height: 0},
};

const LoadRegionContext = createContext<WaitStore | null>(null);
const ActionRegionContext = createContext<WaitStore | null>(null);

type SlowNoticeProps = {
  active: boolean;
  className?: string;
  insetClassName?: string;
};

function SlowNotice({active, className, insetClassName}: SlowNoticeProps) {
  const slow = useSlowAfter(active);
  const reduced = useReducedMotion();
  return <AnimatePresence>
    {slow && <motion.div
      key="slow"
      data-slot="slow-notice"
      role="status"
      {...BLUR_FADE}
      transition={reduced ? {duration: 0} : {duration: 0.28, ease: [0.22, 1, 0.36, 1]}}
      className={cn('min-w-0 overflow-hidden', className)}
    >
      <p className={cn('type-body-sm text-text-2', insetClassName)}>{SLOW_NOTICE}</p>
    </motion.div>}
  </AnimatePresence>;
}

type SlowRegionProps = {
  children: ReactNode;
  active?: boolean;
  className?: string;
};

function SlowRegion({children, active = false, className}: SlowRegionProps) {
  const {store, waiting} = useWaitRegion();
  return <LoadRegionContext.Provider value={store}>
    <SlowNotice active={waiting || active} insetClassName={className}/>
    {children}
  </LoadRegionContext.Provider>;
}

function useLoadingMark() {
  useMarkWaiting(useContext(LoadRegionContext), true);
}

function useActionMark(active: boolean) {
  const region = useContext(ActionRegionContext);
  useMarkWaiting(region, active);
  return region !== null;
}

export {
  SlowNotice,
  SlowRegion,
  LoadRegionContext,
  ActionRegionContext,
  useLoadingMark,
  useActionMark,
  SLOW_NOTICE,
  type SlowNoticeProps,
  type SlowRegionProps,
};
