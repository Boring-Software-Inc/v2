"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
	createContext,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	CHART_EMPTY,
	classes as cn,
	EMPTY_VALUE,
	useScrollTabStop,
} from "#/components/common/chart-data";
import "./chart-parts.css";

// The pieces every Tripwire chart shares: the config and legend state (ChartContainer), each series' tone and swatch,
// the measuring and roving-focus hooks, the tooltip, the data table and the legend. chart.tsx re-exports all of it.
//
// Colour in a chart follows Tripwire's one rule: colour means status. A series is ink. A second is ink at 60% (text-2's
// step, 5.5:1 on paper, so it still clears the 3:1 a line needs). Past two, the steps repeat drawn differently, a dashed
// line and a hollow bar, because ink at 45% sits barely over 3:1 and a third grey would be a guess. Green, amber and coral
// go only on a series that is a status (status: 'ok', 'warn' or 'fail': passed, retried and failed runs), never to
// tell two ordinary series apart. Every series draws in currentColor, set by one text class, so the line, the bar,
// the swatch and the legend can never disagree.
//
// The tooltip is Tooltip's look, the one inverse chip in Tripwire: ink with the inverse label, the tag corner, no shadow.
// Ink series turn to the inverse ink on it, so a swatch never vanishes into the chip.

type ChartStatus = "ok" | "warn" | "fail";

type ChartSeriesConfig = {
	/** The series name, in the legend, the tooltip, the table and every point's accessible name. */
	label: string;
	/** A series that is an outcome (passed, retried, failed runs) takes that status's colour. Nothing else takes colour. */
	status?: ChartStatus;
	/** Draw it dashed (a line) or hollow (a bar), a cue that needs no hue. The third and later ink series get it anyway. */
	dashed?: boolean;
};

type ChartConfig = Record<string, ChartSeriesConfig>;

type ChartContextValue = {
	config: ChartConfig;
	keys: string[];
	/** Series switched off in the legend. */
	hidden: ReadonlySet<string>;
	toggle: (key: string) => void;
	/** The series the legend points at; the others dim. */
	highlight: string | null;
	setHighlight: (key: string | null) => void;
};

const ChartContext = createContext<ChartContextValue | null>(null);

/** The config, hidden series and highlight of the nearest ChartContainer. Throws outside one. */
function useChart() {
	const context = useContext(ChartContext);
	if (!context)
		throw new Error("useChart must be used within a <ChartContainer/>");
	return context;
}

function useOptionalChart() {
	return useContext(ChartContext);
}

type ChartContainerProps = React.ComponentProps<"div"> & {
	config: ChartConfig;
	/** The config's x field, when it has one (it names the table's first column): left out of the series. */
	xKey?: string;
	/** Series that start switched off. */
	defaultHidden?: string[];
};

/** Holds the config and the legend state for the charts and legend inside it. */
function ChartContainer({
	config,
	xKey,
	defaultHidden,
	className,
	children,
	...props
}: ChartContainerProps) {
	const [hidden, setHidden] = useState<ReadonlySet<string>>(
		() => new Set(defaultHidden),
	);
	const [highlight, setHighlight] = useState<string | null>(null);
	const toggle = useCallback(
		(key: string) =>
			setHidden((prev) => {
				const next = new Set(prev);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				return next;
			}),
		[],
	);
	const value = useMemo(
		() => ({
			config,
			keys: Object.keys(config).filter((k) => k !== xKey),
			hidden,
			toggle,
			highlight,
			setHighlight,
		}),
		[config, xKey, hidden, toggle, highlight],
	);
	return (
		<ChartContext.Provider value={value}>
			<div
				data-slot="chart"
				className={cn("flex w-full min-w-0 flex-col", className)}
				{...props}
			>
				{children}
			</div>
		</ChartContext.Provider>
	);
}

/** Wraps a chart in its own container when it was given a config and is not inside one. */
function WithChart({
	config,
	xKey,
	children,
}: {
	config?: ChartConfig;
	xKey?: string;
	children: ReactNode;
}) {
	const context = useOptionalChart();
	if (context || !config) return children;
	return (
		<ChartContainer config={config} xKey={xKey}>
			{children}
		</ChartContainer>
	);
}

// ---------- Tone ----------

type Tone = "ink" | "ink-2" | ChartStatus;

/** The text class that sets a tone's currentColor, on paper and on the ink tooltip chip. */
const toneClass = {
	ink: "chart-tone-ink",
	"ink-2": "chart-tone-ink-muted",
	ok: "chart-tone-ok",
	warn: "chart-tone-warn",
	fail: "chart-tone-fail",
};
const toneOnInk = {
	ink: "chart-tone-inverse",
	"ink-2": "chart-tone-inverse-muted",
	ok: "chart-tone-ok",
	warn: "chart-tone-warn",
	fail: "chart-tone-fail",
};

/**
 * A series' tone and whether it is dashed: ink, then ink at 60%, then both again dashed. Status series keep their
 * colour. keys is the series in order (the container's, which leaves out the x field).
 */
function seriesTone(
	config: ChartConfig,
	key: string,
	keys: string[] = Object.keys(config),
) {
	const { status, dashed = false } = config[key] ?? {};
	if (status) return { tone: status, dashed } as const;
	const inkIndex = Math.max(
		0,
		keys.filter((k) => !config[k]?.status).indexOf(key),
	);
	return {
		tone: (inkIndex % 2 === 0 ? "ink" : "ink-2") satisfies Tone,
		dashed: dashed || inkIndex >= 2,
	} as const;
}

/** The class that colours what draws a series: its tone as currentColor. */
function seriesClass(
	config: ChartConfig,
	key: string,
	onInk = false,
	keys?: string[],
) {
	const { tone } = seriesTone(config, key, keys);
	return (onInk ? toneOnInk : toneClass)[tone];
}

/**
 * The series' key: a short 8px line in its tone, the plot's own stroke in little, dashed for a dashed series. Never a
 * dot. Off (switched away in the legend) drops it to text-3; the name beside it is struck through.
 */
function ChartSwatch({
	config,
	series,
	onInk,
	off,
	className,
}: {
	config: ChartConfig;
	series: string;
	onInk?: boolean;
	off?: boolean;
	className?: string;
}) {
	const keys = useOptionalChart()?.keys;
	const { dashed } = seriesTone(config, series, keys);
	return (
		<svg
			data-slot="chart-swatch"
			aria-hidden
			focusable="false"
			width={8}
			height={8}
			viewBox="0 0 8 8"
			className={cn(
				"shrink-0",
				off ? "chart-tone-disabled" : seriesClass(config, series, onInk, keys),
				className,
			)}
		>
			<title>{config[series]?.label ?? series}</title>
			<line
				x1={0}
				y1={4}
				x2={8}
				y2={4}
				strokeWidth={2}
				strokeDasharray={dashed ? "3 2" : undefined}
				data-chart-stroke="system"
			/>
		</svg>
	);
}

// ---------- Hooks ----------

/** The width of an element, kept current with a ResizeObserver. 0 until it mounts. */
function useElementWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const observer = new ResizeObserver(([entry]) =>
			setWidth(Math.round(entry.contentRect.width)),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [ref, width] as const;
}

/** The element's own reading direction, so a chart under dir="rtl" mirrors. */
function useElementDirection(
	ref: React.RefObject<HTMLElement | null>,
): "ltr" | "rtl" {
	const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const read = () =>
			setDirection(
				getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr",
			);
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["dir"],
			subtree: true,
		});
		return () => observer.disconnect();
	}, [ref]);
	return direction;
}

/**
 * Roving focus over a row of points: one point in the tab order; arrows, Home and End move it, Shift moves seven. In a
 * right-to-left chart the side arrows follow the screen.
 */
function useRovingPoints(
	count: number,
	onMove: (index: number, el: HTMLElement | null) => void,
) {
	const [current, setCurrent] = useState(count - 1);
	const refs = useRef<(HTMLElement | null)[]>([]);
	const safe = Math.min(Math.max(current, 0), count - 1);
	const move = (index: number) => {
		const next = Math.min(Math.max(index, 0), count - 1);
		setCurrent(next);
		const el = refs.current[next];
		el?.focus();
		onMove(next, el ?? null);
	};
	const onKeyDown = (event: React.KeyboardEvent, index: number) => {
		const step = event.shiftKey ? 7 : 1;
		const back =
			getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
		const moves = {
			ArrowRight: index + step * back,
			ArrowDown: index + step,
			ArrowLeft: index - step * back,
			ArrowUp: index - step,
			Home: 0,
			End: count - 1,
		};
		if (!Object.hasOwn(moves, event.key)) return;
		const next = moves[event.key as keyof typeof moves];
		event.preventDefault();
		move(next);
	};
	return {
		current: safe,
		setCurrent,
		onKeyDown,
		tabIndex: (index: number) => (index === safe ? 0 : -1),
		ref: (index: number) => (el: HTMLElement | null) => {
			refs.current[index] = el;
		},
	};
}

// ---------- Tooltip ----------

const GAP = 8;
const EDGE = 8;

type ChartTooltipProps = {
	/** The point to point at, in viewport pixels. null hides the tooltip. */
	anchor: { x: number; y: number } | null;
	children?: ReactNode;
	className?: string;
};

/** The chip at a point: Tooltip's ink chip, above the point, flipped under it near the top, kept 8px inside the viewport. */
function ChartTooltip({ anchor, children, className }: ChartTooltipProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [place, setPlace] = useState<{ left: number; top: number } | null>(
		null,
	);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!anchor || !el) {
			setPlace(null);
			return;
		}
		const { width, height } = el.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const top =
			anchor.y - GAP - height < EDGE ? anchor.y + GAP : anchor.y - GAP - height;
		const left = Math.min(
			Math.max(anchor.x - width / 2, EDGE),
			vw - width - EDGE,
		);
		setPlace({ left, top });
	}, [anchor]);

	const portal = globalThis.document?.body;
	if (!anchor || !portal) return null;
	const tooltip = (
		<div
			ref={(element) => {
				ref.current = element;
				if (element) {
					element.style.left = `${place?.left ?? 0}px`;
					element.style.top = `${place?.top ?? 0}px`;
				}
			}}
			data-slot="chart-tooltip"
			aria-hidden
			className={cn(!place && "invisible", className)}
		>
			{children}
		</div>
	);
	return createPortal(tooltip, portal);
}

/** A title (the x value) over the rows. */
function ChartTooltipContent({
	title,
	children,
	className,
}: {
	title?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div data-slot="chart-tooltip-content" className={className}>
			{title && <div data-slot="chart-tooltip-title">{title}</div>}
			{children}
		</div>
	);
}

/** One series on the chip: its swatch, its name and its value, the value at the end in tabular figures. */
function ChartTooltipRow({
	indicator,
	summary,
	label,
	value,
	className,
}: {
	indicator?: ReactNode;
	summary?: boolean;
	label: ReactNode;
	value: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-slot="chart-tooltip-row"
			data-summary={summary || undefined}
			className={className}
		>
			{indicator}
			<span data-slot="chart-tooltip-label" className="min-w-0 flex-1 truncate">
				{label}
			</span>
			<span data-slot="chart-tooltip-value" className="data">
				{value}
			</span>
		</div>
	);
}

// ---------- Data table ----------

type ChartDataTableColumn = { key: string; label: ReactNode };
type ChartDataTableRow = {
	key: string;
	label: ReactNode;
	values: Record<string, ReactNode>;
};

type ChartDataTableProps = {
	/** The table's name. Usually the chart's label. */
	caption: ReactNode;
	/** The one row a table with no rows shows, so an empty chart still says so. */
	empty?: ReactNode;
	/** The head of the first column, which names each row. */
	rowHeader?: ReactNode;
	columns: ChartDataTableColumn[];
	rows: ChartDataTableRow[];
	/** Show the table instead of keeping it for screen readers only. */
	visible?: boolean;
	className?: string;
};

const thClass = "chart-table-heading";
const tdClass = "chart-table-cell";

/** Every chart's data as a table: hidden for a screen reader, or visible behind the frame's Chart / Table switch. */
const ChartDataTable = memo(function ChartDataTable({
	caption,
	rowHeader = "Date",
	columns,
	rows,
	empty = CHART_EMPTY,
	visible,
	className,
}: ChartDataTableProps) {
	const box = useRef<HTMLDivElement>(null);
	const tab = useScrollTabStop(box, !!visible);
	const captionId = useId();

	return (
		<div
			ref={box}
			data-slot="chart-data-table"
			data-visible={visible || undefined}
			tabIndex={tab}
			role={tab === 0 ? "region" : undefined}
			{...(tab === 0
				? { "aria-labelledby": captionId }
				: { "aria-labelledby": undefined })}
			className={cn(
				visible
					? "max-h-(--popup-max) overflow-auto focus-visible:focus-ring-inset"
					: "sr-only",
				className,
			)}
		>
			<table className="w-full border-separate border-spacing-0 text-start">
				<caption id={captionId} className="sr-only">
					{caption}
				</caption>
				<thead>
					<tr>
						<th scope="col" className={cn(thClass, "text-start")}>
							{rowHeader}
						</th>
						{columns.map((column) => (
							<th
								key={column.key}
								scope="col"
								className={cn(thClass, "text-end")}
							>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody data-slot="chart-data-table-body">
					{rows.length === 0 && (
						<tr data-slot="chart-data-table-empty">
							<td
								colSpan={columns.length + 1}
								className={cn(tdClass, "text-start chart-tone-ink-muted")}
							>
								{empty}
							</td>
						</tr>
					)}
					{rows.map((row) => (
						<tr key={row.key}>
							<th
								scope="row"
								className={cn(tdClass, "text-start chart-table-row-title")}
							>
								{row.label}
							</th>
							{columns.map((column) => (
								<td
									key={column.key}
									className={cn(tdClass, "data text-end chart-tone-ink")}
								>
									{row.values[column.key] ?? EMPTY_VALUE}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
});

// ---------- Legend ----------

const chartLegendVariants = cva("flex min-w-0", {
	variants: {
		layout: {
			row: "flex-wrap items-center",
			column: "flex-col",
		},
	},
	defaultVariants: { layout: "row" },
});

type ChartLegendProps = Omit<React.ComponentProps<"ul">, "children"> &
	VariantProps<typeof chartLegendVariants> & {
		/** Series to list. Defaults to every key in the config. */
		series?: string[];
		/** A value after each name: the latest reading, a total. */
		values?: Record<string, ReactNode>;
		/** Let people switch series off. Off makes the legend a plain key. */
		toggle?: boolean;
	};

/** The key: each series' swatch and name as a 26px pill that switches it off and on, and points at it on hover. */
function ChartLegend({
	series,
	values,
	toggle = true,
	layout = "row",
	className,
	...props
}: ChartLegendProps) {
	const {
		config,
		keys,
		hidden,
		toggle: flip,
		highlight,
		setHighlight,
	} = useChart();
	const list = series ?? keys;
	return (
		<ul
			data-slot="chart-legend"
			data-layout={layout}
			className={cn(chartLegendVariants({ layout }), className)}
			{...props}
		>
			{list.map((key) => {
				const off = hidden.has(key);
				const dim = highlight !== null && highlight !== key;
				const body = (
					<>
						<ChartSwatch config={config} series={key} off={off} />
						<span
							className={cn(
								"min-w-0 truncate",
								off
									? "chart-tone-ink-muted line-through decoration-1"
									: "chart-tone-ink",
							)}
						>
							{config[key]?.label ?? key}
						</span>
						{values?.[key] !== undefined && (
							<span data-slot="chart-legend-value" className="data">
								{values[key]}
							</span>
						)}
					</>
				);
				const item =
					"flex h-(--control-sm) w-full min-w-0 items-center gap-1.5 rounded-pill px-2 type-label-sm";
				return (
					<li
						key={key}
						className={cn(
							"min-w-0 transition-opacity duration-(--dur-state)",
							dim && "opacity-(--stale)",
							layout === "column" && "w-full",
						)}
					>
						{toggle ? (
							<button
								type="button"
								data-slot="chart-legend-item"
								aria-pressed={!off}
								onClick={() => flip(key)}
								onPointerEnter={() => !off && setHighlight(key)}
								onPointerLeave={() => setHighlight(null)}
								onFocus={() => !off && setHighlight(key)}
								onBlur={() => setHighlight(null)}
								onKeyDown={(event) => {
									if (event.key === "Escape") setHighlight(null);
								}}
								className={cn(item, "chart-legend-toggle")}
							>
								{body}
							</button>
						) : (
							<span data-slot="chart-legend-item" className={item}>
								{body}
							</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}

const chartHitSlop =
	"relative pointer-coarse:after:absolute pointer-coarse:after:-z-1 pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:h-full pointer-coarse:after:min-h-11 pointer-coarse:after:w-full pointer-coarse:after:min-w-11 pointer-coarse:after:-translate-1/2";

export {
	chartHitSlop,
	ChartContainer,
	WithChart,
	useChart,
	useOptionalChart,
	useElementWidth,
	useElementDirection,
	useRovingPoints,
	seriesTone,
	seriesClass,
	ChartSwatch,
	ChartTooltip,
	ChartTooltipContent,
	ChartTooltipRow,
	ChartDataTable,
	ChartLegend,
	chartLegendVariants,
	type ChartConfig,
	type ChartSeriesConfig,
	type ChartStatus,
	type ChartContextValue,
	type Tone,
	type ChartTooltipProps,
	type ChartDataTableProps,
	type ChartDataTableColumn,
	type ChartDataTableRow,
	type ChartLegendProps,
};
