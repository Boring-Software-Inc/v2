"use client";

import { StatusMark } from "@tripwire/ui/status";
import { cva, type VariantProps } from "class-variance-authority";
import { useRef, useState } from "react";
import {
	CHART_EMPTY,
	classes as cn,
	EMPTY_VALUE,
} from "#/components/common/chart-data";
import {
	ChartDataTable,
	type ChartStatus,
	ChartTooltip,
	ChartTooltipContent,
	ChartTooltipRow,
	chartHitSlop,
	useElementWidth,
	useRovingPoints,
} from "#/components/common/chart-parts";

// The two charts that are a strip rather than a plot: the sparkline beside a number and the status bar of buckets.
// chart.tsx re-exports both. Both read right to left under dir="rtl".
//
// The sparkline is ink, a 1.5px line with a small square on its last value, or ink bars; status turns it to an outcome's colour
// when the number it sits beside is one (an error rate is fail). The status bar is a row of capsules, one per bucket:
// a quiet bucket is the grey field, a bucket that went fine is ink at 45% (the 3:1 a mark needs), and only a bucket
// with trouble takes colour, amber or coral, so the eye lands on the bad day and not on thirty green ones.

// ---------- Sparkline ----------

const sparklineVariants = cva("relative inline-block min-w-0 align-middle", {
	variants: {
		size: {
			sm: "h-4",
			default: "h-(--control-sm)",
			lg: "h-(--control-lg)",
		},
	},
	defaultVariants: { size: "default" },
});

const statusText = {
	ok: "chart-tone-ok",
	warn: "chart-tone-warn",
	fail: "chart-tone-fail",
};

type SparklineProps = Omit<React.ComponentProps<"div">, "children"> &
	VariantProps<typeof sparklineVariants> & {
		/** Values in order, oldest first. null is a gap. */
		data: (number | null)[];
		/** What the values are: "Runs per hour". Names the table and the points. */
		label: string;
		/** The values are an outcome's: an error rate is fail. Ink without it. */
		status?: ChartStatus;
		variant?: "line" | "bar";
		/** A faint wash under the line. */
		area?: boolean;
		/** Mark the last value with a small square. On for lines. */
		end?: boolean;
		/** Names for each point, for the table and the tooltip: dates or bucket labels. */
		labels?: string[];
		valueFormat?: (value: number) => string;
		/** Focus and hover each point, with a tooltip. */
		interactive?: boolean;
	};

const VIEW_H = 100;
const PAD = 8;

/** What a screen reader hears for the values: "up from 412 to 549, low 401, high 549". */
function trendWords(values: number[], format: (v: number) => string) {
	if (!values.length) return "no data";
	const first = values[0],
		last = values[values.length - 1];
	const direction = last > first ? "up" : last < first ? "down" : "flat";
	return `${direction} from ${format(first)} to ${format(last)}, low ${format(Math.min(...values))}, high ${format(Math.max(...values))}`;
}

function Sparkline({
	data,
	label,
	status,
	variant = "line",
	area,
	end = variant === "line",
	labels,
	valueFormat = (v) => v.toLocaleString("en-US"),
	interactive,
	size = "default",
	className,
	...props
}: SparklineProps) {
	const values = data.filter(
		(v): v is number => v !== null && Number.isFinite(v),
	);
	const n = data.length;
	const lo = variant === "bar" ? Math.min(0, ...values) : Math.min(...values);
	const hi = Math.max(...values, lo + 1);
	const viewW = Math.max(n - 1, 1) * 10;
	const y = (v: number) =>
		PAD + (1 - (v - lo) / (hi - lo || 1)) * (VIEW_H - PAD * 2);
	const x = (i: number) =>
		variant === "bar"
			? (i + 0.5) * (viewW / n)
			: n === 1
				? viewW / 2
				: (i / (n - 1)) * viewW;
	const nameAt = (i: number) => labels?.[i] ?? `Point ${i + 1}`;

	const segments: { x: number; y: number }[][] = [];
	let run: { x: number; y: number }[] = [];
	data.forEach((v, i) => {
		if (v === null || !Number.isFinite(v)) {
			if (run.length) segments.push(run);
			run = [];
			return;
		}
		run.push({ x: x(i), y: y(v) });
	});
	if (run.length) segments.push(run);

	const lastIndex = data.findLastIndex((v) => v !== null && Number.isFinite(v));
	const svgRef = useRef<SVGSVGElement>(null);
	const [active, setActive] = useState<number | null>(null);
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
	const show = (i: number) => {
		setActive(i);
		const svg = svgRef.current;
		const rect = svg?.getBoundingClientRect();
		const v = data[i];
		if (!svg || !rect) return;
		const along = (x(i) / viewW) * rect.width;
		const rtl = getComputedStyle(svg).direction === "rtl";
		setAnchor({
			x: rtl ? rect.right - along : rect.left + along,
			y: rect.top + ((v === null ? VIEW_H : y(v)) / VIEW_H) * rect.height,
		});
	};
	const hide = () => {
		setActive(null);
		setAnchor(null);
	};
	const roving = useRovingPoints(n, (i) => show(i));
	const activeValue = active === null ? null : (data[active] ?? null);
	const pct = (px: number, total: number) => `${(px / total) * 100}%`;
	const tone = status ? statusText[status] : "chart-tone-ink";

	// A div that stays inline-block, so it sits in a line of text; it holds the data table, so never inside a <p>.
	return (
		<div
			data-slot="sparkline"
			data-status={status}
			data-variant={variant}
			className={cn(sparklineVariants({ size }), "w-24", tone, className)}
			{...props}
		>
			<ChartDataTable
				caption={`${label}: ${trendWords(values, valueFormat)}`}
				empty={CHART_EMPTY}
				rowHeader="Point"
				columns={[{ key: "v", label }]}
				rows={data.map((v, i) => ({
					key: String(i),
					label: nameAt(i),
					values: { v: v === null ? EMPTY_VALUE : valueFormat(v) },
				}))}
			/>
			<svg
				ref={svgRef}
				aria-hidden
				viewBox={`0 0 ${viewW} ${VIEW_H}`}
				preserveAspectRatio="none"
				className="block size-full overflow-visible rtl:-scale-x-100"
			>
				<title>{label}</title>
				{variant === "bar" ? (
					data.map(
						(v, i) =>
							v !== null &&
							Number.isFinite(v) && (
								<rect
									key={`${nameAt(i)}-${v}`}
									x={x(i) - (viewW / n) * 0.32}
									width={(viewW / n) * 0.64}
									y={Math.min(y(v), y(0))}
									height={Math.max(Math.abs(y(0) - y(v)), 2)}
									className={cn(
										"chart-fill-current transition-opacity duration-(--dur-state)",
										active !== null && active !== i && "opacity-(--stale)",
									)}
								/>
							),
					)
				) : (
					<>
						{area &&
							segments.map(
								(pts) =>
									pts.length > 1 && (
										<path
											key={`area-${pts[0]?.x}-${pts[0]?.y}`}
											d={`M${pts[0].x},${VIEW_H}${pts.map((p) => `L${p.x},${p.y}`).join("")}L${pts[pts.length - 1].x},${VIEW_H}Z`}
											data-slot="sparkline-area"
										/>
									),
							)}
						{segments.map(
							(pts) =>
								pts.length === 1 && (
									<path
										key={`dot-${pts[0]?.x}-${pts[0]?.y}`}
										d={`M${pts[0].x},${pts[0].y}h0`}
										fill="none"
										vectorEffect="non-scaling-stroke"
										strokeLinecap="round"
										strokeWidth={4}
										stroke="currentColor"
									/>
								),
						)}
						{segments.map(
							(pts) =>
								pts.length > 1 && (
									<path
										key={`line-${pts[0]?.x}-${pts[0]?.y}`}
										d={pts
											.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`)
											.join("")}
										fill="none"
										vectorEffect="non-scaling-stroke"
										strokeLinejoin="round"
										strokeLinecap="round"
										strokeWidth={size === "sm" ? 1 : 1.5}
										data-chart-stroke="system"
									/>
								),
						)}
					</>
				)}
			</svg>
			{variant === "line" &&
				(active ?? (end ? lastIndex : -1)) >= 0 &&
				(() => {
					const i = active ?? lastIndex;
					const v = data[i];
					if (v === null || !Number.isFinite(v)) return null;
					// value-ok: the square sits on the value's point, a share of the drawing, so it can only live inline.
					return (
						<span
							aria-hidden
							data-slot="sparkline-end"
							className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2"
							ref={(element) => {
								if (!element) return;
								element.style.insetInlineStart = pct(x(i), viewW);
								element.style.top = pct(y(v), VIEW_H);
							}}
						/>
					);
				})()}
			{interactive && n > 0 && (
				<>
					<fieldset
						aria-label={label}
						aria-roledescription="chart"
						className="absolute inset-0 isolate flex"
						onPointerLeave={hide}
					>
						{data.map((v, i) => (
							<button
								key={`${nameAt(i)}-${v ?? "empty"}`}
								ref={roving.ref(i)}
								type="button"
								tabIndex={roving.tabIndex(i)}
								aria-label={`${nameAt(i)}: ${v === null ? "no data" : valueFormat(v)}`}
								onPointerEnter={() => {
									roving.setCurrent(i);
									show(i);
								}}
								onFocus={() => {
									roving.setCurrent(i);
									show(i);
								}}
								onBlur={(event) => {
									if (
										!event.currentTarget.parentElement?.contains(
											event.relatedTarget as Node,
										)
									)
										hide();
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") hide();
									else roving.onKeyDown(event, i);
								}}
								className={cn(
									"h-full min-w-0 flex-1 rounded-tag focus-visible:focus-ring-inset",
									chartHitSlop,
								)}
							/>
						))}
					</fieldset>
					<ChartTooltip anchor={active !== null ? anchor : null}>
						{active !== null && (
							<ChartTooltipContent title={nameAt(active)}>
								<ChartTooltipRow
									label={label}
									value={
										activeValue !== null
											? valueFormat(activeValue)
											: EMPTY_VALUE
									}
								/>
							</ChartTooltipContent>
						)}
					</ChartTooltip>
				</>
			)}
		</div>
	);
}

// ---------- Status bar ----------

type StatusBarBucket = {
	/** The bucket's name: a date, an hour. Under the strip's ends and in the tooltip. */
	label: string;
	/** Runs, deploys or requests in the bucket. 0 is a quiet cell. */
	count: number;
	/** The worst outcome in the bucket. warn and fail take colour; ok stays ink. */
	status?: ChartStatus;
	/** How many of the count failed or warned, for the tooltip. */
	issues?: number;
	/** Replaces the generated text in the tooltip and the cell's name: "12 runs, 2 failed". */
	description?: string;
};

const statusBarVariants = cva("flex w-full min-w-0", {
	variants: {
		size: {
			sm: "h-4",
			default: "h-(--control-sm)",
			lg: "h-(--control)",
		},
	},
	defaultVariants: { size: "default" },
});

type StatusBarProps = Omit<React.ComponentProps<"div">, "children"> &
	VariantProps<typeof statusBarVariants> & {
		data: StatusBarBucket[];
		/** What the strip shows: "Runs, last 30 days". Names the cells and the table. */
		label: string;
		/** The noun for count, singular and plural. */
		unit?: [string, string];
		/** Text under the strip's ends. Defaults to the first and last bucket labels; false for none. */
		range?: [React.ReactNode, React.ReactNode] | false;
		/** A cell pressed with the pointer, Enter or Space: open that bucket's runs. */
		onBucketClick?: (bucket: StatusBarBucket, index: number) => void;
	};

const statusWords = { ok: "Passed", warn: "Warning", fail: "Failed" } as const;
const cellTone = {
	quiet: "bg-field",
	ok: "bg-line-strong",
	warn: "bg-warn",
	fail: "bg-fail",
} as const;

function StatusBar({
	data,
	label,
	unit = ["run", "runs"],
	range,
	onBucketClick,
	size = "default",
	className,
	...props
}: StatusBarProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState<number | null>(null);
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
	const cells = useRef<(HTMLElement | null)[]>([]);
	const show = (i: number, el?: HTMLElement | null) => {
		setActive(i);
		const rect = (el ?? cells.current[i])?.getBoundingClientRect();
		if (rect) setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
	};
	const hide = () => {
		setActive(null);
		setAnchor(null);
	};
	const roving = useRovingPoints(data.length, (i, el) => show(i, el));
	const noun = (n: number) =>
		`${n.toLocaleString("en-US")} ${n === 1 ? unit[0] : unit[1]}`;
	const describe = (b: StatusBarBucket) => {
		if (b.description) return b.description;
		const parts = [b.count ? noun(b.count) : `No ${unit[1]}`];
		if (b.status && b.status !== "ok")
			parts.push(
				`${b.issues ?? ""} ${b.status === "fail" ? "failed" : "with warnings"}`.trim(),
			);
		return parts.join(", ");
	};
	const ends =
		range === false
			? null
			: (range ?? [data[0]?.label, data[data.length - 1]?.label]);
	// Whole-pixel cells: the width shared out in integers, so no cell edge lands between pixels and blurs at 1x.
	const [stripRef, stripWidth] = useElementWidth<HTMLFieldSetElement>();
	const gapPx = data.length > 60 ? 1 : 2;
	const avail = stripWidth - gapPx * (data.length - 1);
	const cellWidth = (i: number) =>
		stripWidth && avail >= data.length
			? Math.floor(((i + 1) * avail) / data.length) -
				Math.floor((i * avail) / data.length)
			: undefined;

	return (
		<div
			ref={ref}
			data-slot="status-bar"
			className={cn("flex w-full min-w-0 flex-col", className)}
			{...props}
		>
			<ChartDataTable
				caption={label}
				rowHeader="Bucket"
				columns={[
					{ key: "count", label: unit[1][0].toUpperCase() + unit[1].slice(1) },
					{ key: "status", label: "Status" },
				]}
				rows={data.map((b, i) => ({
					key: String(i),
					label: b.label,
					values: {
						count: b.count.toLocaleString("en-US"),
						status: b.count ? statusWords[b.status ?? "ok"] : EMPTY_VALUE,
					},
				}))}
				empty={CHART_EMPTY}
			/>
			<fieldset
				ref={stripRef}
				data-slot="status-bar-strip"
				data-dense={data.length > 60 || undefined}
				aria-label={label}
				aria-roledescription="status bar"
				className={cn(statusBarVariants({ size }), "isolate")}
				onPointerLeave={() => {
					if (!ref.current?.contains(document.activeElement)) hide();
				}}
			>
				{data.map((b, i) => {
					const tone = b.count === 0 ? "quiet" : (b.status ?? "ok");
					const w = cellWidth(i);
					return (
						<button
							key={b.label}
							ref={(el) => {
								cells.current[i] = el;
								roving.ref(i)(el);
								if (!el) return;
								el.style.inlineSize = w ? `${w}px` : "";
								el.style.flex = w ? "none" : "";
							}}
							type="button"
							tabIndex={roving.tabIndex(i)}
							data-slot="status-bar-cell"
							data-tone={tone}
							aria-label={`${b.label}: ${describe(b)}`}
							onPointerEnter={(event) => {
								roving.setCurrent(i);
								show(i, event.currentTarget);
							}}
							onFocus={(event) => {
								roving.setCurrent(i);
								show(i, event.currentTarget);
							}}
							onBlur={(event) => {
								if (
									!event.currentTarget.parentElement?.contains(
										event.relatedTarget as Node,
									)
								)
									hide();
							}}
							onKeyDown={(event) => {
								if (event.key === "Escape") hide();
								else roving.onKeyDown(event, i);
							}}
							onClick={onBucketClick && (() => onBucketClick(b, i))}
							className={cn(
								"h-full min-w-px flex-1 rounded-pill transition-opacity duration-(--dur-state) focus-sm",
								chartHitSlop,
								cellTone[tone],
								active !== null && active !== i && "opacity-(--stale)",
								onBucketClick ? "cursor-pointer" : "cursor-default",
							)}
						/>
					);
				})}
			</fieldset>
			{ends && (
				<div aria-hidden data-slot="status-bar-ends" className="data">
					<span>{ends[0]}</span>
					<span>{ends[1]}</span>
				</div>
			)}
			<ChartTooltip anchor={active !== null ? anchor : null}>
				{active !== null && data[active] && (
					<ChartTooltipContent title={data[active].label}>
						<ChartTooltipRow
							indicator={
								<StatusMark
									status={
										data[active].count === 0
											? "idle"
											: (data[active].status ?? "ok")
									}
								/>
							}
							label={
								data[active].count
									? statusWords[data[active].status ?? "ok"]
									: "Quiet"
							}
							value={describe(data[active])}
						/>
					</ChartTooltipContent>
				)}
			</ChartTooltip>
		</div>
	);
}

export {
	Sparkline,
	sparklineVariants,
	StatusBar,
	statusBarVariants,
	type SparklineProps,
	type StatusBarProps,
	type StatusBarBucket,
};
