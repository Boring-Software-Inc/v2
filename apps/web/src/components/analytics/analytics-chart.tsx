"use client";

import type { MouseEvent, ReactNode } from "react";
import { Chart } from "#/components/glaze/ui/chart";
import { hoursAgo } from "#/lib/analytics";

function hourLabel(index: number, length: number): string {
	const ago = hoursAgo(index, length);
	return ago === 0 ? "Now" : `${ago}h ago`;
}

function pointIndex(event: MouseEvent<HTMLDivElement>): number | null {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return null;
	const point = target.closest("button");
	const group = point?.parentElement;
	if (!point || group?.getAttribute("role") !== "group") return null;
	return Array.prototype.indexOf.call(group.children, point);
}

export function AnalyticsChart({
	series,
	suffix,
	label,
	description,
	onCommit,
}: {
	series: number[];
	suffix?: string;
	label: string;
	description?: ReactNode;
	onCommit: (index: number) => void;
}) {
	const data = series.map((value, i) => ({
		hour: hourLabel(i, series.length),
		value,
	}));

	return (
		<div
			data-feedback-name="AnalyticsChart"
			onClickCapture={(event) => {
				const index = pointIndex(event);
				if (index !== null && index >= 0) onCommit(index);
			}}
		>
			<Chart
				area
				config={{ hour: { label: "Hour" }, value: { label } }}
				data={data}
				description={description}
				label={`${label}, last 24 hours`}
				type="line"
				unit="count"
				valueFormat={suffix ? (v) => `${v}${suffix}` : undefined}
				xKey="hour"
			/>
		</div>
	);
}
