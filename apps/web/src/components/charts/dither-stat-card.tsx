import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ReactNode, useMemo } from "react";
import type { DitherColor } from "#/components/charts/dither-chart";
import {
	Area,
	AreaChart,
	type ChartConfig,
} from "#/components/charts/dither-kit";
import { ScrambleText } from "#/components/charts/scramble-text";
import { cn } from "#/lib/utils";

/** Which direction of change is GOOD for this metric — drives the delta colour.
 * "neutral" is honest for a metric where up/down isn't good or bad (e.g. blocks
 * — either the gate is working or you're under attack). A ZERO delta is always
 * neutral (omitted), never a red ▼0. */
export type GoodDirection = "up" | "down" | "neutral";

export type DitherStatCardProps = {
	label: string;
	value: string;
	delta: number;
	goodDirection?: GoodDirection;
	series: number[];
	color: DitherColor;
	/** Stagger the scramble intro across a row of cards. */
	delay?: number;
	/** Only scramble on a genuine load — skip when data was cached. */
	animate?: boolean;
	/** When set, the card links into the analytics view for this metric. */
	/** Deep link into /$org/$repo/analytics (URL-scoped, §8). */
	linkTo?: { org: string; repo: string; metric?: string };
	/** Replaces the scrambled value (e.g. a live NumberFlow on analytics). */
	valueNode?: ReactNode;
	/** Rings the card to mark it as the focused metric. */
	focused?: boolean;
	/** When set, the card behaves as a tab button selecting this metric. */
	onClick?: () => void;
	/**
	 * Shared-element id for the mini chart. Match this to the analytics big
	 * chart's `layoutId` so the spark morphs into it across the navigation.
	 */
	chartLayoutId?: string;
	/** Override the card surface (e.g. a darker panel on the analytics page). */
	className?: string;
};

export function DitherStatCard({
	label,
	value,
	delta,
	goodDirection = "up",
	series,
	color,
	delay = 0,
	animate = true,
	linkTo,
	valueNode,
	focused,
	onClick,
	chartLayoutId,
	className,
}: DitherStatCardProps) {
	const up = delta > 0;
	// Zero delta is neutral (omitted). Otherwise colour by whether the change
	// went the good way; a neutral metric stays grey.
	const deltaTone =
		delta === 0
			? null
			: goodDirection === "neutral"
				? "text-muted-foreground"
				: (goodDirection === "up" ? up : !up)
					? "text-emerald-500"
					: "text-red-500";

	// The composable dither chart takes rows + a series config; the sparkline is a
	// single series keyed "v". An all-zero window has no trend to draw — we show a
	// flat baseline line instead of copy, so the card stays a chart, not fugly text.
	const hasData = useMemo(() => series.some((v) => v > 0), [series]);
	const chartData = useMemo(() => series.map((v) => ({ v })), [series]);
	const chartConfig = useMemo<ChartConfig>(() => ({ v: { color } }), [color]);

	const body = (
		<div
			className={cn(
				"overflow-hidden rounded-xl bg-card ring-foreground/15",
				focused && "ring-1",
				className,
			)}
		>
			<div className="flex flex-col gap-1.5 px-3.5 pt-3.5 pb-2.5">
				<ScrambleText
					text={label}
					delay={delay}
					animate={animate}
					className="text-xs text-muted-foreground"
				/>
				<div className="flex items-baseline gap-2">
					{valueNode ?? (
						<ScrambleText
							text={value}
							delay={delay}
							animate={animate}
							className="font-sans text-2xl text-foreground"
						/>
					)}
					{deltaTone ? (
						<span
							className={cn(
								"inline-flex items-center gap-1 font-mono text-[11px] tabular-nums",
								deltaTone,
							)}
						>
							<span className="text-[8px] leading-none">{up ? "▲" : "▼"}</span>
							{Math.abs(delta)}
						</span>
					) : null}
				</div>
			</div>
			<motion.div
				layoutId={chartLayoutId}
				transition={{ type: "spring", stiffness: 320, damping: 34 }}
				className="relative h-11"
			>
				{hasData ? (
					<AreaChart
						data={chartData}
						config={chartConfig}
						interactive={false}
						animate={animate}
						bloom="aura"
						margins={{ top: 0, right: 0, bottom: 0, left: 0 }}
						className="absolute inset-0"
					>
						<Area dataKey="v" variant="gradient" />
					</AreaChart>
				) : (
					<div className="absolute inset-0 flex items-center px-3">
						<div className="h-px w-full bg-foreground/15" />
					</div>
				)}
			</motion.div>
		</div>
	);

	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				className="block w-full rounded-xl text-left outline-none ring-ring/50 transition-shadow focus-visible:ring-2 hover:ring-1 hover:ring-border"
			>
				{body}
			</button>
		);
	}

	if (linkTo) {
		return (
			<Link
				to="/$org/$repo/analytics"
				params={{ org: linkTo.org, repo: linkTo.repo }}
				search={linkTo.metric ? { metric: linkTo.metric } : {}}
				className="block rounded-xl outline-none ring-ring/50 transition-shadow focus-visible:ring-2 hover:ring-1 hover:ring-border"
			>
				{body}
			</Link>
		);
	}

	return body;
}
