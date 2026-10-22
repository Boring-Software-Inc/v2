'use client';

import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {createPortal} from 'react-dom';
import {useGlazePortal} from '#/lib/glaze/portal.ts';
import {useAnyWaiting, useSlowAfter, useWaiting} from '#/lib/glaze/waiting.ts';
import {cn} from '#/lib/glaze/utils.ts';

const SLOW_NOTICE = 'This is taking abnormally long to process.';

const BLUR_FADE = {
  initial: {opacity: 0, filter: 'blur(6px)'},
  animate: {opacity: 1, filter: 'blur(0px)'},
  exit: {opacity: 0, filter: 'blur(6px)'},
};

type SlowNoticeProps = {
  active: boolean;
  className?: string;
};

function SlowNotice({active, className}: SlowNoticeProps) {
  const slow = useSlowAfter(active);
  const reduced = useReducedMotion();
  return <div data-slot="slow-notice" role="status" className={className}>
    <AnimatePresence>
      {slow && <motion.p
        key="slow"
        {...BLUR_FADE}
        transition={reduced ? {duration: 0} : {duration: 0.28, ease: [0.22, 1, 0.36, 1]}}
        className="overlay inline-flex h-(--control) items-center rounded-pill px-3 type-body-sm text-text-2"
      >{SLOW_NOTICE}</motion.p>}
    </AnimatePresence>
  </div>;
}

function SlowNoticeHost({className}: {className?: string}) {
  const container = useGlazePortal();
  const waiting = useAnyWaiting();
  if (!container) return null;
  return createPortal(<SlowNotice
    active={waiting}
    className={cn('pointer-events-none fixed inset-x-0 bottom-6 z-[calc(var(--z-overlay)+1)] flex justify-center px-4', className)}
  />, container);
}

function Waiting({active}: {active: boolean}) {
  useWaiting(active);
  return null;
}

export {SlowNotice, SlowNoticeHost, Waiting, SLOW_NOTICE, type SlowNoticeProps};
