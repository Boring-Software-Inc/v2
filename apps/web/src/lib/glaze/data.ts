'use client';

import {useEffect, useRef, useState, type RefObject} from 'react';

// What the data components share: one unit per column of numbers, a token read at runtime, the tab stop a scroll box
// takes while it scrolls, and the wait-then-hold timing of placeholder rows. Table, DataGrid, Chart, Timeline and
// LogViewer read it; nothing here draws.
//
// One unit per column: the unit comes from the column's largest value, so 950ms and 1.2s never sit in one column.
// Every formatter rounds before it picks the unit, so 59,999ms reads 1.0min, never 60.0s, and zero never reads "-0".
// A missing or non-finite value reads EMPTY_VALUE and never picks the unit.

type Unit = {unit: string; size: number};

/** What a cell, tooltip or table says when there is no value. One word everywhere. */
export const EMPTY_VALUE = 'None';

/** What a chart says when it has no points to draw. */
export const CHART_EMPTY = 'No data in this range';

const durationUnits: readonly Unit[] = [
  {unit: 'ms', size: 1},
  {unit: 's', size: 1_000},
  {unit: 'min', size: 60_000},
  {unit: 'h', size: 3_600_000},
];

const countUnits: readonly Unit[] = [
  {unit: '', size: 1},
  {unit: 'k', size: 1_000},
  {unit: 'M', size: 1_000_000},
  {unit: 'B', size: 1_000_000_000},
];

const largest = (values: readonly number[]) => values.reduce((max, v) => (Number.isFinite(v) ? Math.max(max, Math.abs(v)) : max), 0);
const roundTo = (x: number, digits: number) => Number(x.toFixed(digits));

/** toFixed without a sign on a value that rounds to zero. */
export function fixed(x: number, digits: number) {
  const s = x.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** The biggest unit the largest value reaches, then one up while the value, rounded as it will show, reaches the next. */
function pickUnit(max: number, units: readonly Unit[], threshold: (i: number) => number, digits: (i: number) => number) {
  let i = 0;
  while (i < units.length - 1 && max >= threshold(i + 1)) i++;
  while (i < units.length - 1 && roundTo(max / units[i].size, digits(i)) * units[i].size >= threshold(i + 1)) i++;
  return i;
}

/** The duration unit for a column of milliseconds. */
export function durationUnitFor(values: readonly number[], digits = 1): Unit & {digits: number} {
  const digitsAt = (i: number) => (i === 0 ? 0 : digits);
  const i = pickUnit(largest(values), durationUnits, j => durationUnits[j].size, digitsAt);
  return {...durationUnits[i], digits: digitsAt(i)};
}

/** One duration unit for a column of milliseconds, and every value in it. */
export function formatDurations(values: readonly number[], {digits = 1}: {digits?: number} = {}) {
  const {unit, size, digits: d} = durationUnitFor(values, digits);
  return {unit, values: values.map(v => (Number.isFinite(v) ? `${fixed(v / size, d)}${unit}` : EMPTY_VALUE))};
}

/** The magnitude for a column of counts. k starts at 10,000, so four digits stay whole. */
export function countUnitFor(values: readonly number[], digits = 1): Unit & {digits: number} {
  const digitsAt = (i: number) => (i === 0 ? 0 : digits);
  const i = pickUnit(largest(values), countUnits, j => countUnits[j].size * 10, digitsAt);
  return {...countUnits[i], digits: digitsAt(i)};
}

/** One magnitude (none, k, M, B) for a column of counts, and every value in it. */
export function formatCounts(values: readonly number[], {digits = 1}: {digits?: number} = {}) {
  const {unit, size, digits: d} = countUnitFor(values, digits);
  const format = new Intl.NumberFormat('en-US', {maximumFractionDigits: d, minimumFractionDigits: d, signDisplay: 'negative'});
  return {unit, values: values.map(v => (Number.isFinite(v) ? `${format.format(v / size)}${unit}` : EMPTY_VALUE))};
}

/** A token's value in px or ms, read off an element: "8px" is 8, "150ms" is 150, "0.15s" is 150. The fallback covers the server. */
export function cssNumber(el: Element | null | undefined, name: string, fallback: number): number {
  if (!el || typeof getComputedStyle === 'undefined') return fallback;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const match = raw.match(/^(-?[\d.]+)(px|ms|s)?$/);
  if (!match) return fallback;
  const n = parseFloat(match[1]);
  return match[2] === 's' ? n * 1000 : n;
}

/**
 * 0 while the element's content overflows it and undefined while it fits, so a scroll box joins the tab order only
 * while there is something past its edge for the arrow keys to reach (WCAG 2.1.1).
 */
export function useScrollTabStop(ref: RefObject<HTMLElement | null>, enabled = true): 0 | undefined {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) { setScrolls(false); return; }
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of el.children) resize.observe(child);
      measure();
    };
    const swap = new MutationObserver(watch);
    swap.observe(el, {childList: true});
    watch();
    return () => { resize.disconnect(); swap.disconnect(); };
  }, [ref, enabled]);
  return scrolls ? 0 : undefined;
}

/**
 * When placeholder rows show: 'wait' for the first --wait-show of a load (their room held, nothing drawn), 'shown' after
 * it until at least --wait-hold has passed, 'off' otherwise. A fast load never flashes them; a slow one never blinks.
 */
export function useLoadingPhase(loading: boolean, ref: RefObject<HTMLElement | null>) {
  const [phase, setPhase] = useState<'wait' | 'shown' | 'off'>(loading ? 'wait' : 'off');
  const shownAt = useRef(0);
  useEffect(() => {
    if (!loading) { setPhase(p => (p === 'wait' ? 'off' : p)); return; }
    setPhase(p => (p === 'shown' ? p : 'wait'));
    const t = window.setTimeout(() => setPhase(p => {
      if (p !== 'shown') shownAt.current = Date.now();
      return 'shown';
    }), cssNumber(ref.current, '--wait-show', 150));
    return () => window.clearTimeout(t);
  }, [loading, ref]);
  useEffect(() => {
    if (loading || phase !== 'shown') return;
    const left = cssNumber(ref.current, '--wait-hold', 400) - (Date.now() - shownAt.current);
    const t = window.setTimeout(() => setPhase('off'), Math.max(0, left));
    return () => window.clearTimeout(t);
  }, [loading, phase, ref]);
  return phase;
}
