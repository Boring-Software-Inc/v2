import type { WorkflowNode } from "@tripwire/contracts";
import { Handle, Position } from "@xyflow/react";
import { cn } from "#/lib/utils";

/**
 * One visual for all four node kinds — kind is a tinted chip, body is the
 * node's essential line. Follows the tripwire-design skill: rounded-md,
 * surface tints, severity-restraint on color.
 */

const KIND_CHIP: Record<WorkflowNode["type"], string> = {
	trigger: "bg-brand/10 text-brand",
	rule: "bg-surface-2 text-foreground",
	gate: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
	action: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function nodeBody(node: WorkflowNode): string {
	switch (node.type) {
		case "trigger":
			return node.kinds.join(", ");
		case "rule":
			return node.ref;
		case "gate":
			return node.mode;
		case "action":
			return node.action;
		default:
			return "";
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

export function TripwireNode({ data }: { data: { node: WorkflowNode } }) {
	const { node } = data;
	return (
		<div className="min-w-40 rounded-md border bg-card px-3 py-2 shadow-sm">
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
						KIND_CHIP[node.type],
					)}
				>
					{node.type}
				</span>
			</div>
			<div className="mt-1 truncate font-mono text-xs">{nodeBody(node)}</div>
			{canFail(node) ? (
				<>
					<Handle
						position={Position.Right}
						style={{ top: "35%" }}
						type="source"
					/>
					<Handle
						id="fail"
						position={Position.Right}
						style={{ top: "70%", background: "#ef4444" }}
						type="source"
					/>
				</>
			) : isModeration(node) ? (
				<>
					<Handle
						id="approve"
						position={Position.Right}
						style={{ top: "35%", background: "#22c55e" }}
						type="source"
					/>
					<Handle
						id="deny"
						position={Position.Right}
						style={{ top: "70%", background: "#ef4444" }}
						type="source"
					/>
				</>
			) : (
				<Handle position={Position.Right} type="source" />
			)}
		</div>
	);
}
