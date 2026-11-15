import { type ReactNode, useRef } from "react";

export interface SkeletonProps {
	fill?: boolean;
}

export function Skeleton({ fill = false }: SkeletonProps) {
	return (
		<span
			aria-hidden="true"
			data-fill={fill || undefined}
			data-slot="skeleton"
		/>
	);
}

export interface SkeletonTextProps {
	lines?: number;
	type?:
		| "heading"
		| "heading-sm"
		| "body"
		| "body-sm"
		| "label"
		| "label-sm"
		| "caption"
		| "code"
		| "code-sm";
}

export function SkeletonText({ lines = 1, type = "body" }: SkeletonTextProps) {
	const count = Math.max(1, Math.floor(lines));
	const lineKeys = Array.from(
		{ length: count },
		(_, index) => `line-${index + 1}`,
	);
	return (
		<span
			aria-hidden="true"
			data-lines={count}
			data-slot="skeleton-text"
			data-type={type}
		>
			{lineKeys.map((lineKey) => (
				<span data-slot="skeleton" key={lineKey} />
			))}
		</span>
	);
}

export interface SkeletonSwapProps {
	children: ReactNode;
	fallback: ReactNode;
	label?: string;
	loading: boolean;
	layout?: "default" | "fill";
}

export function SkeletonSwap({
	children,
	fallback,
	label = "Loading",
	layout = "default",
	loading,
}: SkeletonSwapProps) {
	const hasContent = useRef(!loading);
	if (!loading) hasContent.current = true;
	const initialLoad = loading && !hasContent.current;
	return (
		<div
			aria-busy={loading || undefined}
			data-layout={layout}
			data-slot="skeleton-swap"
		>
			{initialLoad ? (
				<output aria-label={label} data-slot="skeleton-fallback">
					{fallback}
				</output>
			) : (
				children
			)}
		</div>
	);
}
