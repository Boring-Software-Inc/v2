"use client";

import { type RefObject, useEffect, useState } from "react";

export const EMPTY_VALUE = "None";
export const CHART_EMPTY = "No data in this range";

interface Unit {
	unit: string;
	size: number;
}

const DURATION_UNITS: readonly Unit[] = [
	{ unit: "ms", size: 1 },
	{ unit: "s", size: 1_000 },
	{ unit: "min", size: 60_000 },
	{ unit: "h", size: 3_600_000 },
];
const COUNT_UNITS: readonly Unit[] = [
	{ unit: "", size: 1 },
	{ unit: "k", size: 1_000 },
	{ unit: "M", size: 1_000_000 },
	{ unit: "B", size: 1_000_000_000 },
];

export function fixed(value: number, digits: number) {
	const formatted = value.toFixed(digits);
	return /^-0(\.0+)?$/.test(formatted) ? formatted.slice(1) : formatted;
}

function pickUnit(
	values: readonly number[],
	units: readonly Unit[],
	scale: number,
) {
	const largest = values.reduce(
		(maximum, value) =>
			Number.isFinite(value) ? Math.max(maximum, Math.abs(value)) : maximum,
		0,
	);
	let index = 0;
	while (index < units.length - 1 && largest >= units[index + 1].size * scale) {
		index += 1;
	}
	return { ...units[index], digits: index === 0 ? 0 : 1 };
}

export function durationUnitFor(values: readonly number[]) {
	return pickUnit(values, DURATION_UNITS, 1);
}

export function formatDurations(values: readonly number[]) {
	const { digits, size, unit } = durationUnitFor(values);
	return {
		unit,
		values: values.map((value) =>
			Number.isFinite(value)
				? `${fixed(value / size, digits)}${unit}`
				: EMPTY_VALUE,
		),
	};
}

export function countUnitFor(values: readonly number[]) {
	return pickUnit(values, COUNT_UNITS, 10);
}

export function cssNumber(
	element: Element | null | undefined,
	name: string,
	fallback: number,
) {
	const view = element?.ownerDocument.defaultView;
	if (!element || !view) return fallback;
	const raw = view.getComputedStyle(element).getPropertyValue(name).trim();
	const match = raw.match(/^(-?[\d.]+)(px|ms|s)?$/);
	if (!match) return fallback;
	const value = Number.parseFloat(match[1]);
	return match[2] === "s" ? value * 1000 : value;
}

export function useScrollTabStop(
	ref: RefObject<HTMLElement | null>,
	enabled = true,
): 0 | undefined {
	const [scrolls, setScrolls] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!(element && enabled)) {
			setScrolls(false);
			return;
		}
		const measure = () =>
			setScrolls(
				element.scrollWidth > element.clientWidth + 1 ||
					element.scrollHeight > element.clientHeight + 1,
			);
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		for (const child of element.children) resize.observe(child);
		measure();
		return () => resize.disconnect();
	}, [enabled, ref]);
	return scrolls ? 0 : undefined;
}

export function classes(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(" ");
}
