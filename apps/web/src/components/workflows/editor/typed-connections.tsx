import type {
	ConnectionHint,
	EdgeWhen,
	GateInput,
	WorkflowPort,
} from "@tripwire/contracts";
import {
	type DragPlan,
	handlePort,
	handleReason,
	type NodeVerdict,
	outputLook,
	type PortLook,
	WORKFLOW_PORT_TONE,
} from "@tripwire/contracts";
import {
	BaseEdge,
	type ConnectionLineComponentProps,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	useConnection,
	useInternalNode,
	useReactFlow,
	useViewport,
	ViewportPortal,
} from "@xyflow/react";
import { createContext, useContext } from "react";
import { StatusMark } from "#/components/glaze/ui/status";
import { tooltipPopupClass } from "#/components/glaze/ui/tooltip";
import { previewPath } from "#/components/workflows/editor/connection-plan";
import type { TripwireFlowNode } from "#/components/workflows/editor/node-card";
import {
	useEdgeProblems,
	useProblems,
} from "#/components/workflows/editor/node-issues";
import {
	ProblemPeek,
	severityStatus,
} from "#/components/workflows/editor/problems-list";

export const DragPlanContext = createContext<DragPlan | null>(null);

export function useDragPlan(): DragPlan | null {
	return useContext(DragPlanContext);
}

export function useNodeVerdict(nodeId: string): NodeVerdict | null {
	return useContext(DragPlanContext)?.verdicts.get(nodeId) ?? null;
}

export function PortGlyph({ look }: { look: PortLook & { io: "in" | "out" } }) {
	return (
		<span
			aria-hidden
			data-port-glyph=""
			data-port-io={look.io}
			data-port-negated={look.negated || undefined}
			data-port-shape={look.shape}
			data-port-tone={look.tone}
		/>
	);
}

export type TypedFlowEdge = Edge<
	{ port?: WorkflowPort; when?: EdgeWhen; input?: GateInput },
	"typed"
>;

export function TypedEdge({
	id,
	sourceX,
	sourceY,
	sourcePosition,
	targetX,
	targetY,
	targetPosition,
	data,
	interactionWidth,
	style,
}: EdgeProps<TypedFlowEdge>) {
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	});
	const port = data?.port ?? "pass";
	const problems = useEdgeProblems(id);
	const { onFix } = useProblems();
	const status = problems.length > 0 ? severityStatus(problems) : null;
	const place = {
		transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
	};
	return (
		<>
			<BaseEdge
				data-edge-tone={WORKFLOW_PORT_TONE[port]}
				interactionWidth={interactionWidth}
				path={path}
				pathLength={1}
				style={style}
			/>
			{status ? (
				<EdgeLabelRenderer>
					<div
						className="nodrag nopan pointer-events-auto absolute flex rounded-pill bg-paper"
						data-edge-problem-peek=""
						style={place}
					>
						<ProblemPeek className="flex" onFix={onFix} problems={problems}>
							<StatusMark
								label={problems.map((problem) => problem.message).join(". ")}
								status={status}
							/>
						</ProblemPeek>
					</div>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
}

interface DropTarget {
	status: "valid" | "invalid" | null;
	reason: ConnectionHint | null;
	port: WorkflowPort | null;
	at: { x: number; y: number };
}

function useDropTarget(): DropTarget | null {
	const connection = useConnection<TripwireFlowNode>();
	const plan = useDragPlan();
	const { getIntersectingNodes } = useReactFlow<TripwireFlowNode>();
	if (!(connection.inProgress && plan)) {
		return null;
	}
	const at = connection.to;
	const handle = connection.toHandle;
	const facing = handle !== null && handle.type !== connection.fromHandle.type;
	const overNode =
		(facing ? connection.toNode : null) ??
		getIntersectingNodes({ x: at.x, y: at.y, width: 1, height: 1 }).at(-1) ??
		null;
	const verdict = overNode ? plan.verdicts.get(overNode.id) : undefined;
	if (facing && overNode) {
		const valid = connection.isValid === true;
		return {
			status: valid ? "valid" : "invalid",
			reason: valid ? null : handleReason(verdict, handle.id),
			port:
				plan.port ?? (valid ? handlePort(overNode.data.node, handle.id) : null),
			at,
		};
	}
	if (verdict && !verdict.origin && verdict.reason) {
		return { status: "invalid", reason: verdict.reason, port: plan.port, at };
	}
	return { status: null, reason: null, port: plan.port, at };
}

export function TypedConnectionLine({
	fromX,
	fromY,
	fromPosition,
	toX,
	toY,
	toPosition,
	toHandle,
}: ConnectionLineComponentProps<TripwireFlowNode>) {
	const target = useDropTarget();
	const path = toHandle
		? getBezierPath({
				sourceX: fromX,
				sourceY: fromY,
				sourcePosition: fromPosition,
				targetX: toX,
				targetY: toY,
				targetPosition: toPosition,
			})[0]
		: previewPath({ x: fromX, y: fromY }, { x: toX, y: toY });
	const port = target?.port ?? null;
	return (
		<path
			className="react-flow__connection-path"
			d={path}
			data-line-status={target?.status ?? "idle"}
			data-line-tone={port ? WORKFLOW_PORT_TONE[port] : "neutral"}
			fill="none"
		/>
	);
}

export function DropHint() {
	const target = useDropTarget();
	const viewport = useViewport();
	if (!target?.reason) {
		return null;
	}
	const position = {
		transform: `translate(${target.at.x * viewport.zoom + viewport.x}px, ${target.at.y * viewport.zoom + viewport.y}px)`,
	};
	return (
		<div
			className="pointer-events-none absolute start-0 top-0"
			data-drop-hint=""
			style={position}
		>
			<div className={tooltipPopupClass}>
				<span className="shrink-0 whitespace-nowrap type-code-xs">
					{target.reason.rule}
				</span>
				<span className="min-w-0">{target.reason.message}</span>
			</div>
		</div>
	);
}

export function PendingConnection({
	nodeId,
	handleId,
	port,
	at,
}: {
	nodeId: string;
	handleId: string | null;
	port: WorkflowPort;
	at: { x: number; y: number };
}) {
	const node = useInternalNode<TripwireFlowNode>(nodeId);
	const handle = node?.internals.handleBounds?.source?.find(
		(entry) => (entry.id ?? null) === handleId,
	);
	const marker = { transform: `translate(${at.x}px, ${at.y}px)` };
	const path =
		node && handle
			? previewPath(
					{
						x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
						y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
					},
					at,
				)
			: null;
	return (
		<ViewportPortal>
			{path ? (
				<svg
					aria-hidden="true"
					className="pointer-events-none absolute start-0 top-0 size-px overflow-visible"
				>
					<path
						className="react-flow__connection-path"
						d={path}
						data-line-status="idle"
						data-line-tone={WORKFLOW_PORT_TONE[port]}
						fill="none"
					/>
				</svg>
			) : null}
			<div
				className="pointer-events-none absolute"
				data-pending-port=""
				style={marker}
			>
				<PortGlyph look={{ ...outputLook(port), io: "in" }} />
			</div>
		</ViewportPortal>
	);
}
