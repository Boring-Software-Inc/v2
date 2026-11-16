"use client";

import "./chart-frame.css";

import { Button } from "@tripwire/ui/button";
import { ChartLine, TableView } from "@tripwire/ui/icon";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { Skeleton } from "@tripwire/ui/skeleton";
import { Status } from "@tripwire/ui/status";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	CHART_EMPTY,
	classes as cn,
	EMPTY_VALUE,
} from "#/components/common/chart-data";
import {
	type ChartConfig,
	ChartContainer,
	type ChartContextValue,
	ChartDataTable,
	type ChartDataTableColumn,
	type ChartDataTableProps,
	type ChartDataTableRow,
	ChartLegend,
	type ChartLegendProps,
	type ChartSeriesConfig,
	type ChartStatus,
	ChartSwatch,
	ChartTooltip,
	ChartTooltipContent,
	type ChartTooltipProps,
	ChartTooltipRow,
	chartLegendVariants,
	seriesClass,
	seriesTone,
	useChart,
	useElementDirection,
	useElementWidth,
	useOptionalChart,
	useRovingPoints,
	WithChart,
} from "#/components/common/chart-parts";
import {
	BarChart,
	type BarChartProps,
	ChartPlot,
	type ChartPlotProps,
	type ChartScale,
	LineChart,
	type LineChartProps,
} from "#/components/common/chart-plot";
import {
	type ChartAxisValue,
	type ChartRow,
	type ChartUnit,
	type Curve,
	formatCompact,
	linearPath,
	monotonePath,
	niceScale,
	numberAt,
	stepPath,
	unitFormat,
} from "#/components/common/chart-scale";
import {
	Sparkline,
	type SparklineProps,
	StatusBar,
	type StatusBarBucket,
	type StatusBarProps,
	sparklineVariants,
	statusBarVariants,
} from "#/components/common/chart-strip";

// Tripwire's chart: one component, <Chart type="line" | "bar" | "sparkline" | "status">, with its frame (title, loading,
// error, retry, empty), legend, tooltip and data table built in. Plain SVG, no chart library; the parts stay exported
// for a chart that needs its own layout.
//
// Black and white first. A series is ink, a second ink at 60%, more repeat dashed; colour goes only on a series that is
// a status, and on the status bar's bad buckets. The tooltip is Tooltip's ink chip. Axis labels are the 12px caption in
// text-2, in tabular figures, and the axis, tooltip and table share one unit picked from the largest value.
//
// frame="card" is the chart as a widget, in the card: the grey shell, the white panel holding the title and the plot,
// and the legend on the shell's footer row. plain has no chrome, for a chart beside a number or in a card of its own. none
// is the bare drawing (the sparkline's default).
//
// The detail from the job: a chart holds its exact height in every state, and its loading shape is its own type (bars
// for bar, a line for line, capsules for status), still, in the skeleton's grey, so a dashboard of eight charts never
// jumps as they load and each is recognisable before its data lands. Every chart keeps its data table, empty ones
// too. The files: chart-scale.ts, chart-parts.tsx, chart-plot.tsx, chart-strip.tsx and this one. Import from here.

type ChartFrameStyle = "card" | "plain";
type Shape = "bar" | "line" | "status" | "sparkline";
type ChartBodyHeight = 26 | 40 | 50 | 56 | 200;

type ChartFrameProps = Omit<React.ComponentProps<"section">, "title"> & {
	/** card: the shell, the panel and the footer row. plain: no chrome. */
	frame?: ChartFrameStyle;
	title: string;
	description?: ReactNode;
	/** Controls at the top end: a range Select, a ghost icon Button. */
	actions?: ReactNode;
	/** The legend: on the shell's footer row in a card, under the plot in plain. */
	footer?: ReactNode;
	/** px. The body's height in every state. */
	height?: ChartBodyHeight;
	loading?: boolean;
	/** What failed. Shows the error state instead of the chart. */
	error?: ReactNode;
	onRetry?: () => void;
	/** True while a retry runs. */
	retrying?: boolean;
	/** No data: the sentence to show. */
	empty?: ReactNode;
	/** The data as a visible table. Adds a Chart / Table switch. */
	table?: ReactNode;
	/** The loading shape: the chart's own type. */
	shape?: Shape;
	/** The data is still arriving: a running Live status in the header. */
	live?: boolean;
};

const silhouette = [38, 52, 44, 66, 58, 72, 49, 61, 80, 68, 74, 90];
const statusSilhouette = Array.from({ length: 30 }, (_, index) => ({
	id: `status-${index}`,
}));

/** Each type's loading shape, still, in the skeleton's grey. */
function Silhouette({ shape }: { shape: Shape }) {
	if (shape === "bar")
		return (
			<>
				{silhouette.map((h) => (
					<span
						data-skeleton-box=""
						aria-hidden
						key={h}
						data-chart-silhouette={h}
					>
						<Skeleton fill />
					</span>
				))}
			</>
		);
	if (shape === "status")
		return (
			<span aria-hidden data-chart-silhouette-row="">
				{statusSilhouette.map(({ id }) => (
					<span
						data-skeleton-box=""
						aria-hidden
						key={id}
						className="h-full min-w-1 flex-1 rounded-pill"
					>
						<Skeleton fill />
					</span>
				))}
			</span>
		);
	const points = silhouette
		.map((h, i) => `${(i / (silhouette.length - 1)) * 100},${100 - h}`)
		.join(" ");
	return (
		<svg
			aria-hidden
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			className="chart-silhouette-line"
		>
			<title>Loading chart</title>
			<polyline
				points={points}
				fill="none"
				vectorEffect="non-scaling-stroke"
				strokeLinejoin="round"
				strokeLinecap="round"
				strokeWidth={shape === "line" ? 4 : 2}
				stroke="currentColor"
			/>
		</svg>
	);
}

function ChartFrame({
	title,
	description,
	actions,
	footer,
	height = 200,
	loading,
	error,
	onRetry,
	retrying,
	empty,
	table,
	shape = "bar",
	frame = "card",
	live,
	className,
	children,
	...props
}: ChartFrameProps) {
	const [view, setView] = useState<"chart" | "table">("chart");
	const state = loading
		? "loading"
		: error
			? "error"
			: empty
				? "empty"
				: "ready";
	// Retry unmounts with the error; if it had focus, focus moves to the chart's title, never the page.
	const titleRef = useRef<HTMLHeadingElement>(null);
	const retryFocused = useRef(false);
	useEffect(() => {
		if (state === "error" || !retryFocused.current) return;
		retryFocused.current = false;
		if (!document.activeElement || document.activeElement === document.body)
			titleRef.current?.focus();
	}, [state]);
	const showTable = table && view === "table" && state === "ready";
	const card = frame === "card";

	const header = (
		<header data-slot="chart-frame-header">
			<div data-slot="chart-frame-copy">
				<h2
					ref={titleRef}
					tabIndex={-1}
					data-slot="chart-frame-title"
					className="outline-none"
				>
					{title}
				</h2>
				{description && (
					<p data-slot="chart-frame-description">{description}</p>
				)}
			</div>
			{(actions || table || live) && (
				<div data-slot="chart-frame-actions">
					{live && (
						<Status status="running" size="small">
							Live
						</Status>
					)}
					{actions}
					{table && (
						<SegmentedControl
							ariaLabel="View"
							size="small"
							value={view}
							options={[
								{
									icon: ChartLine,
									iconOnly: true,
									label: "Chart",
									value: "chart",
								},
								{
									icon: TableView,
									iconOnly: true,
									label: "Table",
									value: "table",
								},
							]}
							onValueChange={(next) => {
								if (next === "chart" || next === "table") setView(next);
							}}
						/>
					)}
				</div>
			)}
		</header>
	);

	const body = (
		<div data-slot="chart-frame-plot" data-table={showTable ? "" : undefined}>
			<div
				data-slot="chart-frame-body"
				data-height={showTable ? undefined : height}
			>
				{state === "loading" && (
					<div data-slot="chart-frame-loading" data-shape={shape}>
						<span className="sr-only">Loading {title}</span>
						<Silhouette shape={shape} />
					</div>
				)}
				{/* Top-left, where the chart would start, in a body that keeps its height. */}
				{state === "error" && (
					<output data-slot="chart-frame-error">
						<Status status="fail">{error}</Status>
						{onRetry && (
							<Button
								size="small"
								variant="secondary"
								pending={!!retrying}
								pendingLabel="Retrying"
								onAction={() => {
									retryFocused.current = true;
									onRetry();
								}}
							>
								Retry
							</Button>
						)}
					</output>
				)}
				{state === "empty" && (
					<div data-slot="chart-frame-empty">
						{empty}
						<span aria-hidden data-slot="chart-frame-empty-line" />
					</div>
				)}
				{state === "ready" && (showTable ? table : children)}
			</div>
		</div>
	);

	// The footer keeps its room in every state, so the legend landing never moves what is below.
	const foot =
		footer && !showTable ? (
			<div
				data-slot="chart-frame-footer"
				aria-hidden={state !== "ready" || undefined}
				inert={state !== "ready" || undefined}
				className={cn(card && "shell-foot", state !== "ready" && "invisible")}
			>
				{footer}
			</div>
		) : null;

	return (
		<section
			data-slot="chart-frame"
			data-state={state}
			data-frame={frame}
			aria-busy={loading || undefined}
			className={cn(card && "shell", className)}
			{...props}
		>
			{card ? (
				<div
					data-slot="chart-frame-panel"
					className="panel flex min-w-0 flex-col overflow-hidden"
				>
					{header}
					{body}
				</div>
			) : (
				<>
					{header}
					{body}
				</>
			)}
			{foot}
		</section>
	);
}

// ---------- Chart ----------

type ChartCommon = {
	/** The chart's name: the frame title, the point group and the data table's caption. */
	label: string;
	/** Shown above the chart; the label by default. */
	title?: string;
	description?: ReactNode;
	actions?: ReactNode;
	/** card: shell, panel and footer row. plain: no chrome. none: the bare drawing (the sparkline's default). */
	frame?: "card" | "plain" | "none";
	/** The data is still arriving: a running Live status in the header. */
	live?: boolean;
	/** px. The body holds it in every state. */
	height?: ChartBodyHeight;
	loading?: boolean;
	/** What failed. Shows the error state, with Retry when onRetry is set. */
	error?: ReactNode;
	onRetry?: () => void;
	retrying?: boolean;
	/** The sentence for no data, shown when data is empty. */
	empty?: ReactNode;
	/** Axis, tooltip and table share one unit from the largest value. */
	unit?: ChartUnit;
	valueFormat?: (value: number) => string;
	className?: string;
};

type CartesianChartProps = ChartCommon & {
	type: "line" | "bar";
	data: ChartRow[];
	/** The field that names each row on the x axis. */
	xKey: string;
	config: ChartConfig;
	series?: string[];
	xFormat?: (value: ChartAxisValue, index: number) => string;
	/** The legend on the footer row. On with more than one series. */
	legend?: boolean;
	/** A Chart / Table switch in the header. */
	table?: boolean;
	/** Series switched off at first. */
	defaultHidden?: string[];
	curve?: Curve;
	area?: boolean;
	zero?: boolean;
	stacked?: boolean;
};

type SparklineChartProps = ChartCommon &
	Omit<SparklineProps, "label" | "className" | "size" | "valueFormat"> & {
		type: "sparkline";
		size?: SparklineProps["size"];
	};

type StatusChartProps = ChartCommon &
	Omit<StatusBarProps, "label" | "className" | "size" | "data" | "unit"> & {
		type: "status";
		data: StatusBarBucket[];
		size?: StatusBarProps["size"];
		/** The noun for a bucket's count, singular and plural: ['run', 'runs']. */
		noun?: [string, string];
	};

type ChartProps = CartesianChartProps | SparklineChartProps | StatusChartProps;

/** One chart: line, bar, sparkline or status buckets, with its frame states, legend, tooltip and table. */
function Chart(props: ChartProps) {
	const {
		type,
		label,
		title,
		description,
		actions,
		height,
		loading,
		error,
		onRetry,
		retrying,
		empty,
		unit,
		className,
		live,
	} = props;
	const frame = props.frame ?? (type === "sparkline" ? "none" : "card");
	let values: number[];
	if (props.type === "line" || props.type === "bar") {
		const keys = props.series ?? Object.keys(props.config);
		values = [];
		for (const row of props.data as ChartRow[])
			for (const key of keys)
				if (key !== props.xKey) {
					const v = numberAt(row, key);
					if (v !== null) values.push(v);
				}
	} else if (props.type === "sparkline")
		values = props.data.filter((v) => v !== null);
	else values = (props.data as StatusBarBucket[]).map((b) => b.count);
	const format = props.valueFormat ?? unitFormat(unit, values);
	const isEmpty = !loading && !error && props.data.length === 0;
	// An empty chart still has its table, one row that says so; the sentence on screen is hidden from a reader, so it is heard once.
	const emptyText = empty ?? CHART_EMPTY;
	const emptyColumns =
		props.type === "line" || props.type === "bar"
			? (
					props.series ??
					Object.keys(props.config).filter((k) => k !== props.xKey)
				).map((key) => ({ key, label: props.config[key]?.label ?? key }))
			: props.type === "status"
				? [
						{ key: "count", label: "Count" },
						{ key: "status", label: "Status" },
					]
				: [{ key: "v", label }];
	const emptyState = isEmpty ? (
		<>
			<span aria-hidden>{emptyText}</span>
			<ChartDataTable
				caption={label}
				rowHeader={
					props.type === "line" || props.type === "bar"
						? (props.config[props.xKey]?.label ?? "Date")
						: props.type === "status"
							? "Bucket"
							: "Point"
				}
				columns={emptyColumns}
				rows={[]}
				empty={emptyText}
			/>
		</>
	) : undefined;
	const bodyHeight =
		height ??
		(type === "status"
			? props.size === "sm"
				? 40
				: props.size === "lg"
					? 56
					: 50
			: type === "sparkline"
				? 26
				: 200);

	if (type === "line" || type === "bar") {
		const {
			data,
			xKey,
			config,
			series,
			xFormat,
			curve,
			area,
			zero,
			stacked,
			defaultHidden,
		} = props as CartesianChartProps;
		const shown = series ?? Object.keys(config).filter((k) => k !== xKey);
		const showLegend =
			(props as CartesianChartProps).legend ?? shown.length > 1;
		const chart =
			type === "line" ? (
				<LineChart
					data={data}
					xKey={xKey}
					series={series}
					label={label}
					height={bodyHeight}
					curve={curve}
					area={area}
					zero={zero}
					xFormat={xFormat}
					valueFormat={format}
					empty={empty}
				/>
			) : (
				<BarChart
					data={data}
					xKey={xKey}
					series={series}
					label={label}
					height={bodyHeight}
					stacked={stacked}
					xFormat={xFormat}
					valueFormat={format}
					empty={empty}
				/>
			);
		let tableNode: ReactNode = null;
		if ((props as CartesianChartProps).table) {
			const f = format ?? formatCompact;
			tableNode = (
				<ChartDataTable
					visible
					caption={label}
					rowHeader={config[xKey]?.label ?? "Date"}
					columns={shown.map((key) => ({
						key,
						label: config[key]?.label ?? key,
					}))}
					rows={data.map((row, i) => ({
						key: String(i),
						label: (xFormat ?? ((v) => String(v)))(row[xKey], i),
						values: Object.fromEntries(
							shown.map((key) => {
								const v = numberAt(row, key);
								return [key, v === null ? EMPTY_VALUE : f(v)];
							}),
						),
					}))}
				/>
			);
		}
		return (
			<ChartContainer
				config={config}
				xKey={xKey}
				defaultHidden={defaultHidden}
				className="min-w-0"
			>
				<ChartFrame
					title={title ?? label}
					description={description}
					actions={actions}
					footer={showLegend ? <ChartLegend series={series} /> : null}
					height={bodyHeight}
					loading={loading}
					error={error}
					onRetry={onRetry}
					retrying={retrying}
					empty={emptyState}
					table={tableNode}
					shape={type}
					frame={frame === "card" ? "card" : "plain"}
					live={live}
					data-chart-type={type}
					className={className}
				>
					{chart}
				</ChartFrame>
			</ChartContainer>
		);
	}

	let chart: ReactNode = null;
	if (props.type === "sparkline") {
		const { data, status, variant, area, end, labels, interactive, size } =
			props;
		chart = (
			<Sparkline
				data={data}
				label={label}
				status={status}
				variant={variant}
				area={area}
				end={end}
				labels={labels}
				interactive={interactive}
				size={size}
				valueFormat={format}
				className={frame === "none" ? className : "w-full"}
			/>
		);
	} else if (props.type === "status") {
		const { data, noun, range, onBucketClick, size } = props;
		chart = (
			<StatusBar
				data={data}
				label={label}
				unit={noun}
				range={range}
				onBucketClick={onBucketClick}
				size={size}
				className={frame === "none" ? className : undefined}
			/>
		);
	}
	if (frame === "none") {
		if (loading)
			return (
				<span
					data-slot="chart-frame-loading"
					data-shape={type}
					aria-busy
					className={cn(
						"inline-flex",
						type === "sparkline"
							? "h-(--control-sm) w-24"
							: "h-(--control-sm) w-full",
						className,
					)}
				>
					<span className="sr-only">Loading {label}</span>
					<Silhouette shape={type} />
				</span>
			);
		return chart;
	}
	return (
		<ChartFrame
			title={title ?? label}
			description={description}
			actions={actions}
			height={bodyHeight}
			loading={loading}
			error={error}
			onRetry={onRetry}
			retrying={retrying}
			empty={emptyState}
			shape={type}
			frame={frame}
			live={live}
			data-chart-type={type}
			className={className}
		>
			{chart}
		</ChartFrame>
	);
}

export {
	Chart,
	unitFormat,
	ChartContainer,
	ChartPlot,
	ChartSwatch,
	WithChart,
	useChart,
	useOptionalChart,
	useElementWidth,
	useElementDirection,
	useRovingPoints,
	seriesTone,
	seriesClass,
	niceScale,
	formatCompact,
	numberAt,
	ChartTooltip,
	ChartTooltipContent,
	ChartTooltipRow,
	ChartDataTable,
	ChartLegend,
	chartLegendVariants,
	LineChart,
	monotonePath,
	linearPath,
	stepPath,
	BarChart,
	Sparkline,
	sparklineVariants,
	StatusBar,
	statusBarVariants,
	ChartFrame,
	type ChartProps,
	type ChartUnit,
	type ChartConfig,
	type ChartSeriesConfig,
	type ChartStatus,
	type ChartContextValue,
	type ChartAxisValue,
	type ChartRow,
	type ChartScale,
	type ChartPlotProps,
	type ChartTooltipProps,
	type ChartDataTableProps,
	type ChartDataTableColumn,
	type ChartDataTableRow,
	type ChartLegendProps,
	type LineChartProps,
	type Curve,
	type BarChartProps,
	type SparklineProps,
	type StatusBarProps,
	type StatusBarBucket,
	type ChartFrameProps,
};
