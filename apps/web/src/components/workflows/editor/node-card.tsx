import type { WorkflowNode } from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
	TRIGGER_CATALOG,
} from "@tripwire/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { useNodeIssues } from "#/components/workflows/editor/node-issues";
import { KIND_STYLES } from "#/components/workflows/editor/node-kind-styles";
import { cn } from "#/lib/utils";

/** The one node data shape the canvas renders. */
export type TripwireFlowNode = Node<{ node: WorkflowNode }, "tripwire">;

/**
 * One visual for all four node kinds — kind is a tinted chip, body is the
 * catalog name. Selected = brand ring; invalid = red dot with the issue list
 * as its tooltip. Handle ids are LOAD-BEARING: `handleWhen` maps "fail" /
 * "approve" / "deny" handle ids to edge `when`s.
 */

/** Catalog display name for the node; falls back to the raw ref/kind. */
function nodeName(node: WorkflowNode): string {
	switch (node.type) {
		case "trigger": {
			const names = node.kinds.map(
				(kind) =>
					TRIGGER_CATALOG.find((entry) => entry.kind === kind)?.name ?? kind,
			);
			return names.join(", ") || "trigger";
		}
		case "rule": {
			const [ruleId] = node.ref.split("@");
			return (
				RULE_CATALOG.find((entry) => entry.ruleId === ruleId)?.name ?? node.ref
			);
		}
		case "gate":
			return (
				GATE_CATALOG.find((entry) => entry.mode === node.mode)?.name ??
				node.mode
			);
		case "action":
			return (
				ACTION_CATALOG.find((entry) => entry.action === node.action)?.name ??
				node.action
			);
		default:
			return "";
	}
}

/** The mono detail line — the ref/config essence under the name. */
function nodeDetail(node: WorkflowNode): string | null {
	switch (node.type) {
		case "rule":
			return node.ref;
		case "gate":
			return node.mode;
		case "action":
			return node.action;
		default:
			return null;
	}
}

/** Rule and gate outcomes fork — those nodes expose a second, fail handle. */
function canFail(node: WorkflowNode): boolean {
	return node.type === "rule" || node.type === "gate";
}

/** Moderation decisions fork — approve/deny handles (validate.ts restricts these edges to moderation nodes). */
function isModeration(node: WorkflowNode): boolean {
	return node.type === "action" && node.action === "send-to-moderation";
}

export function TripwireNode({ data, selected }: NodeProps<TripwireFlowNode>) {
	const { node } = data;
	const issues = useNodeIssues(node.id);
	const detail = nodeDetail(node);
	const style = KIND_STYLES[node.type];
	return (
		<div
			className={cn(
				"relative min-w-40 max-w-56 rounded-md border border-l-2 bg-card px-3 py-2 shadow-sm transition-colors",
				style.accent,
				selected && "border-brand/50 ring-2 ring-brand/40",
				issues.length > 0 && !selected && "border-red-500/40",
			)}
		>
			{issues.length > 0 ? (
				<span
					className="absolute -top-1 -right-1 block size-2.5 rounded-full bg-red-500 ring-2 ring-card"
					title={issues.join("\n")}
				/>
			) : null}
			{node.type !== "trigger" ? (
				<Handle
					position={Position.Left}
					style={{ background: "#fff", border: "1px solid #a1a1aa" }}
					type="target"
				/>
			) : null}
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"rounded-full px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide",
						style.chip,
					)}
				>
					{node.type}
				</span>
			</div>
			<div className="mt-1 truncate text-xs">{nodeName(node)}</div>
			{detail ? (
				<div className="truncate font-mono text-[11px] text-muted-foreground">
					{detail}
				</div>
			) : null}
			{canFail(node) ? (
				<>
					<Handle
						position={Position.Right}
						style={{ top: "35%" }}
						title="pass"
						type="source"
					/>
					<Handle
						id="fail"
						position={Position.Right}
						style={{ top: "70%", background: "#ef4444" }}
						title="fail"
						type="source"
					/>
				</>
			) : isModeration(node) ? (
				<>
					<Handle
						id="approve"
						position={Position.Right}
						style={{ top: "35%", background: "#22c55e" }}
						title="approve"
						type="source"
					/>
					<Handle
						id="deny"
						position={Position.Right}
						style={{ top: "70%", background: "#ef4444" }}
						title="deny"
						type="source"
					/>
				</>
			) : node.type === "action" ? null : (
				<Handle position={Position.Right} type="source" />
			)}
		</div>
	);
}
