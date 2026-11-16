import { type ComponentProps, useEffect, useState } from "react";
import { Tooltip } from "./tooltip";

const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const missingTime = "Unknown time";

function formatExactTime(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		timeZone,
		timeZoneName: "short",
	}).format(date);
}

function unitFor(deltaMs: number): [number, Intl.RelativeTimeFormatUnit] {
	const absolute = Math.abs(deltaMs);
	if (absolute < 60_000) return [Math.round(deltaMs / 1000), "second"];
	if (absolute < 3_600_000) return [Math.round(deltaMs / 60_000), "minute"];
	if (absolute < 86_400_000) return [Math.round(deltaMs / 3_600_000), "hour"];
	if (absolute < 2_592_000_000)
		return [Math.round(deltaMs / 86_400_000), "day"];
	if (absolute < 31_536_000_000)
		return [Math.round(deltaMs / 2_592_000_000), "month"];
	return [Math.round(deltaMs / 31_536_000_000), "year"];
}

export function formatRelative(date: Date, now = new Date()) {
	const delta = date.getTime() - now.getTime();
	if (!Number.isFinite(delta)) return missingTime;
	const [value, unit] = unitFor(delta);
	return formatter.format(value, unit);
}

export interface RelativeTimeProps
	extends Omit<ComponentProps<"time">, "dateTime"> {
	date: Date | string | number;
}

export function RelativeTime({ date, ...props }: RelativeTimeProps) {
	const value = date instanceof Date ? date : new Date(date);
	const valid = Number.isFinite(value.getTime());
	const [now, setNow] = useState(() => new Date());
	const [timeZone, setTimeZone] = useState("UTC");
	useEffect(() => {
		if (!valid) return;
		setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
		const timer = window.setInterval(() => setNow(new Date()), 60_000);
		return () => window.clearInterval(timer);
	}, [valid]);
	if (!valid) {
		return (
			<span {...props} data-slot="relative-time">
				{missingTime}
			</span>
		);
	}
	const exactUtc = formatExactTime(value, "UTC");
	const exactLocal =
		timeZone === "UTC" ? exactUtc : formatExactTime(value, timeZone);
	const hint =
		exactLocal === exactUtc ? exactUtc : [exactLocal, exactUtc].join(" · ");
	const relative = formatRelative(value, now);
	return (
		<Tooltip
			trigger={
				/** biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need both exact timestamps available in the hint. */
				<span data-slot="relative-time-trigger" tabIndex={0}>
					<time
						dateTime={value.toISOString()}
						data-slot="relative-time"
						{...props}
					>
						<span aria-hidden="true" suppressHydrationWarning>
							{relative}
						</span>
						<span className="sr-only" suppressHydrationWarning>
							{relative}, {exactLocal}
						</span>
					</time>
				</span>
			}
		>
			{hint}
		</Tooltip>
	);
}
