import { type Node, type NodeProps, useViewport } from "@xyflow/react";

export type LaneHeadFlowNode = Node<
	{ index: number; label: string },
	"laneHead"
>;

export function LaneHeadNode({ data }: NodeProps<LaneHeadFlowNode>) {
	return (
		<div className="pointer-events-none flex w-max max-w-full items-baseline gap-2.5">
			<span className="type-code-xs text-text-3">{data.index}</span>
			<span className="type-body-sm text-text-2">{data.label}</span>
		</div>
	);
}

export function LaneRules({ ys }: { ys: readonly number[] }) {
	const { y, zoom } = useViewport();
	return ys.map((ruleY) => (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-x-0 h-px bg-line-faint"
			key={ruleY}
			style={{ top: Math.round(ruleY * zoom + y) }}
		/>
	));
}
