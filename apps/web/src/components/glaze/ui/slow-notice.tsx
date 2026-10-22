'use client';

import {useEffect, type ReactNode} from 'react';
import {toast} from '#/components/glaze/ui/toast.tsx';
import {createWaitStore, useSlowAfter} from '#/lib/glaze/waiting.ts';

const SLOW_NOTICE = 'This is taking abnormally long to process.';
const SLOW_TOAST_ID = 'slow-wait';

const slowWaits = createWaitStore();
let toastShown = false;
slowWaits.subscribe(() => {
  const waiting = slowWaits.waiting();
  if (waiting === toastShown) return;
  toastShown = waiting;
  if (waiting) toast(SLOW_NOTICE, {id: SLOW_TOAST_ID, timeout: 0});
  else toast.dismiss(SLOW_TOAST_ID);
});

function useSlowWait(active: boolean) {
  const slow = useSlowAfter(active);
  useEffect(() => (slow ? slowWaits.mark() : undefined), [slow]);
}

function StillLabel({pendingLabel}: {pendingLabel: ReactNode}) {
  return <span data-slot="button-still" className="min-w-0 truncate">
    {pendingLabel ? <>Still <span className="inline-block first-letter:lowercase">{pendingLabel}</span></> : 'Still working'}
  </span>;
}

export {StillLabel, useSlowWait, SLOW_NOTICE};
