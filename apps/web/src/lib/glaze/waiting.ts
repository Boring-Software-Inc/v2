'use client';

import {useEffect, useState, useSyncExternalStore} from 'react';

export const SLOW_AFTER_MS = 5000;

export function slowTimer(active: boolean, ms: number, onSlow: () => void) {
  if (!active) return undefined;
  const timer = setTimeout(onSlow, ms);
  return () => clearTimeout(timer);
}

export function useSlowAfter(active: boolean, ms = SLOW_AFTER_MS) {
  const [slow, setSlow] = useState(false);
  if (!active && slow) setSlow(false);
  useEffect(() => slowTimer(active, ms, () => setSlow(true)), [active, ms]);
  return active && slow;
}

export function createWaitStore() {
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    mark() {
      count += 1;
      emit();
      return () => { count -= 1; emit(); };
    },
    waiting: () => count > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const waits = createWaitStore();

export function useWaiting(active: boolean) {
  useEffect(() => (active ? waits.mark() : undefined), [active]);
}

export function useAnyWaiting() {
  return useSyncExternalStore(waits.subscribe, waits.waiting, () => false);
}
