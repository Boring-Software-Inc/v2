import {afterEach, beforeEach, describe, expect, jest, test} from 'bun:test';
import {SLOW_AFTER_MS, createWaitStore, slowTimer} from '#/lib/glaze/waiting.ts';

describe('slowTimer', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('is not slow before the threshold and is slow at it', () => {
    const onSlow = jest.fn();
    slowTimer(true, SLOW_AFTER_MS, onSlow);
    jest.advanceTimersByTime(SLOW_AFTER_MS - 1);
    expect(onSlow).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  test('never fires while inactive', () => {
    const onSlow = jest.fn();
    expect(slowTimer(false, SLOW_AFTER_MS, onSlow)).toBeUndefined();
    jest.advanceTimersByTime(SLOW_AFTER_MS * 2);
    expect(onSlow).not.toHaveBeenCalled();
  });

  test('going inactive resets the wait, so the next one starts from zero', () => {
    const onSlow = jest.fn();
    const stop = slowTimer(true, SLOW_AFTER_MS, onSlow);
    jest.advanceTimersByTime(SLOW_AFTER_MS - 1000);
    stop?.();
    slowTimer(true, SLOW_AFTER_MS, onSlow);
    jest.advanceTimersByTime(SLOW_AFTER_MS - 1);
    expect(onSlow).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  test('the threshold is five seconds', () => {
    expect(SLOW_AFTER_MS).toBe(5000);
  });
});

describe('createWaitStore', () => {
  test('waits while any mark is held and tells subscribers', () => {
    const store = createWaitStore();
    const listener = jest.fn();
    store.subscribe(listener);
    expect(store.waiting()).toBe(false);
    const releaseA = store.mark();
    const releaseB = store.mark();
    releaseA();
    expect(store.waiting()).toBe(true);
    releaseB();
    expect(store.waiting()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
