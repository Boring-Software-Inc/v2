import type { WorkflowNode } from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
} from "@tripwire/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import {
	useCustomRuleName,
	useNodeIssues,
} from "#/components/workflows/editor/node-issues";
import { cn } from "#/lib/utils";

/** The one node data shape the canvas renders. */
export type TripwireFlowNode = Node<{ node: WorkflowNode }, "tripwire">;

/**
 * One visual for all four node kinds. Type reads from STRUCTURE AND WORDS,
 * not hue: the name, the mono ref/mode line, the field rows, and the port
 * layout announce what a node is. The only color on a card is semantic — the
 * green/red outcome ports (and the red issue dot). Gates alone carry a plain
 * text kind label; with no body, the word is their only type signal. Body is
 * the catalog name plus, for value-accepting nodes, inline field rows summarizing
 * the config the properties panel edits (same schema walk, node-fields.ts —
 * display only, editing stays in the panel). Selected = brand ring; invalid =
 * red dot with the issue list as its tooltip. Handle ids are LOAD-BEARING:
 * `handleWhen` maps "fail" / "approve" / "deny" handle ids to edge `when`s —
 * the port blocks are appearance only, every id and type is unchanged.
 */

/** Catalog display name for the node; falls back to the raw ref/kind. */
function nodeName(node: WorkflowNode, customName: string | null): string {
	switch (node.type) {
		case "trigger":
			// The kinds themselves live in the inline field row now.
			return "event trigger";
		case "rule": {
			const [ruleId] = node.ref.split("@");
			return (
				RULE_CATALOG.find((entry) => entry.ruleId === ruleId)?.name ??
				customName ??
				node.ref
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

/**
 * Ports carry meaning by POSITION and COLOR only — no text. Tabs that come
 * OUT of the node: mostly tucked UNDER the card edge (negative z paints them
 * behind the card's fill), a sliver protruding. in sits top-left and the
 * positive out (out/pass/approve) top-right, flanking the header; the
 * negative outcome (fail/deny) holds the bottom-right corner in red, the one
 * hue that separates it from the pass path. Fixed offsets, not height
 * percentages, so tall field-bearing nodes keep every tab in place. Handle
 * ids/types unchanged — edges keyed on `when` stay valid.
 */
const PORT_CLASS = "!-z-10 !h-4 !w-5 !min-w-0 !rounded-[5px] !border-0";
const PORT_NEUTRAL = "!bg-zinc-400 dark:!bg-zinc-500";
const PORT_POSITIVE = "!bg-emerald-500";
const PORT_NEGATIVE = "!bg-red-500";
/** Header-height tabs (in / out / pass / approve). */
const PORT_TOP = { top: 12, transform: "none" } as const;
/** The negative-outcome tab, hugging the bottom-right corner. */
const PORT_CORNER = { top: "auto", bottom: 8, transform: "none" } as const;

export function TripwireNode({ data, selected }: NodeProps<TripwireFlowNode>) {
	const { node } = data;
	const issues = useNodeIssues(node.id);
	const customName = useCustomRuleName(node.type === "rule" ? node.ref : "");
	const detail = nodeDetail(node);
	const fields = nodeFieldValues(node);
	const forked = canFail(node) || isModeration(node);
	return (
		<div
			className={cn(
				"relative min-w-44 max-w-64 rounded-md border bg-card px-3 py-2 shadow-sm transition-colors",
				forked && "min-h-16 pb-2.5",
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
					className={cn(PORT_CLASS, PORT_NEUTRAL, "!-left-[7px]")}
					position={Position.Left}
					style={PORT_TOP}
					title="in"
					type="target"
				/>
			) : null}
			<div className="flex items-baseline gap-1.5">
				<span className="min-w-0 truncate font-medium text-xs">
					{nodeName(node, customName)}
				</span>
				{node.type === "gate" ? (
					<span className="shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide">
						gate
					</span>
				) : null}
			</div>
			{detail ? (
				<div className="truncate font-mono text-[11px] text-muted-foreground">
					{detail}
				</div>
			) : null}
			{fields.length > 0 ? (
				<div className="mt-1.5 flex flex-col gap-1 border-border/70 border-t pt-1.5">
					{fields.map(({ field, value }) => (
						<div
							className="flex items-baseline justify-between gap-2 text-[10px]"
							key={field.key}
						>
							<span className="min-w-0 truncate text-muted-foreground">
								{field.label}
							</span>
							<span className="max-w-[55%] shrink-0 truncate text-right font-medium">
								{summarizeFieldValue(field, value)}
							</span>
						</div>
					))}
				</div>
			) : null}
			{canFail(node) ? (
				<>
					<Handle
						className={cn(PORT_CLASS, PORT_POSITIVE, "!-right-[7px]")}
						position={Position.Right}
						style={PORT_TOP}
						title="pass"
						type="source"
					/>
					<Handle
						className={cn(PORT_CLASS, PORT_NEGATIVE, "!-right-[7px]")}
						id="fail"
						position={Position.Right}
						style={PORT_CORNER}
						title="fail"
						type="source"
					/>
				</>
			) : isModeration(node) ? (
				<>
					<Handle
						className={cn(PORT_CLASS, PORT_POSITIVE, "!-right-[7px]")}
						id="approve"
						position={Position.Right}
						style={PORT_TOP}
						title="approve"
						type="source"
					/>
					<Handle
						className={cn(PORT_CLASS, PORT_NEGATIVE, "!-right-[7px]")}
						id="deny"
						position={Position.Right}
						style={PORT_CORNER}
						title="deny"
						type="source"
					/>
				</>
			) : node.type === "action" ? null : (
				<Handle
					className={cn(PORT_CLASS, PORT_NEUTRAL, "!-right-[7px]")}
					position={Position.Right}
					style={PORT_TOP}
					title="out"
					type="source"
				/>
			)}
		</div>
	);
}
