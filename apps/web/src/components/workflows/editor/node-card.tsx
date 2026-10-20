import type { WorkflowNode } from "@tripwire/contracts";
import {
	ACTION_CATALOG,
	GATE_CATALOG,
	RULE_CATALOG,
} from "@tripwire/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { StatusMark } from "#/components/glaze/ui/status";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import {
	useCustomRuleName,
	useNodeIssues,
} from "#/components/workflows/editor/node-issues";
import { cn } from "#/lib/glaze/utils";

/** The one node data shape the canvas renders. */
export type TripwireFlowNode = Node<{ node: WorkflowNode }, "tripwire">;

/**
 * One visual for all four node kinds. Type reads from STRUCTURE AND WORDS,
 * not hue: the name, the mono ref/mode line, the field rows, and the port
 * layout announce what a node is. The only color on a card is semantic — the
 * ok/fail outcome ports and the fail mark on an invalid node. Gates alone carry
 * a plain text kind label; with no body, the word is their only type signal.
 * Body is the catalog name plus, for value-accepting nodes, inline field rows
 * summarizing the config the properties panel edits (same schema walk,
 * node-fields.ts — display only, editing stays in the panel). Selected = strong
 * line; invalid = fail mark with the issue list as its title. Handle ids are LOAD-BEARING:
 * `handleWhen` maps "fail" / "approve" / "deny" handle ids to edge `when`s —
 * the port blocks are appearance only, every id and type is unchanged.
 */

/** Catalog display name for the node; falls back to the raw ref/kind. */
function nodeName(node: WorkflowNode, customName: string | null): string {
	switch (node.type) {
		case "trigger":
			// The kinds themselves live in the inline field row now.
			return "Trigger";
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
 * negative outcome (fail/deny) holds the bottom-right corner in the fail
 * colour, the one hue that separates it from the pass path. Fixed offsets, not height
 * percentages, so tall field-bearing nodes keep every tab in place. Handle
 * ids/types unchanged — edges keyed on `when` stay valid.
 */
const PORT_CLASS = "!-z-10 !h-4 !w-5 !min-w-0 !rounded-tag !border-0";
const PORT_POSITIVE = "!bg-ok";
const PORT_NEGATIVE = "!bg-fail";
/** Header-height tabs (in / out / pass / approve). */
const PORT_TOP = { top: "var(--space-3)", transform: "none" } as const;
/** The negative-outcome tab, hugging the bottom-right corner. */
const PORT_CORNER = {
	top: "auto",
	bottom: "var(--space-2)",
	transform: "none",
} as const;

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
				"relative min-w-44 max-w-64 rounded-panel border border-line-faint bg-paper px-3 py-2 text-text-1 transition-colors duration-(--dur-state)",
				forked && "min-h-16 pb-3",
				selected && "border-ink",
				issues.length > 0 && !selected && "border-fail",
			)}
		>
			{issues.length > 0 ? (
				<span
					className="absolute -top-2 -right-2 flex rounded-pill bg-paper"
					title={issues.join("\n")}
				>
					<StatusMark label={issues.join(". ")} status="fail" />
				</span>
			) : null}
			{node.type !== "trigger" ? (
				<Handle
					className={cn(PORT_CLASS, "!-left-2")}
					position={Position.Left}
					style={PORT_TOP}
					title="Input"
					type="target"
				/>
			) : null}
			<div className="flex items-baseline gap-1">
				<span className="min-w-0 truncate type-label">
					{nodeName(node, customName)}
				</span>
				{node.type === "gate" ? (
					<span className="shrink-0 type-caption text-text-2">Gate</span>
				) : null}
			</div>
			{detail ? (
				<div className="truncate type-code-xs text-text-2">{detail}</div>
			) : null}
			{fields.length > 0 ? (
				<div className="mt-2 flex flex-col gap-1 border-line-faint border-t pt-2">
					{fields.map(({ field, value }) => (
						<div
							className="flex items-baseline justify-between gap-2 type-caption"
							key={field.key}
						>
							<span className="min-w-0 truncate text-text-2">
								{field.label}
							</span>
							<span className="max-w-1/2 shrink-0 truncate text-end">
								{summarizeFieldValue(field, value)}
							</span>
						</div>
					))}
				</div>
			) : null}
			{canFail(node) ? (
				<>
					<Handle
						className={cn(PORT_CLASS, PORT_POSITIVE, "!-right-2")}
						position={Position.Right}
						style={PORT_TOP}
						title="Next step when it passes"
						type="source"
					/>
					<Handle
						className={cn(PORT_CLASS, PORT_NEGATIVE, "!-right-2")}
						id="fail"
						position={Position.Right}
						style={PORT_CORNER}
						title="Next step when it does not pass"
						type="source"
					/>
				</>
			) : isModeration(node) ? (
				<>
					<Handle
						className={cn(PORT_CLASS, PORT_POSITIVE, "!-right-2")}
						id="approve"
						position={Position.Right}
						style={PORT_TOP}
						title="Next step when a maintainer passes it"
						type="source"
					/>
					<Handle
						className={cn(PORT_CLASS, PORT_NEGATIVE, "!-right-2")}
						id="deny"
						position={Position.Right}
						style={PORT_CORNER}
						title="Next step when a maintainer blocks it"
						type="source"
					/>
				</>
			) : node.type === "action" ? null : (
				<Handle
					className={cn(PORT_CLASS, "!-right-2")}
					position={Position.Right}
					style={PORT_TOP}
					title="Next step"
					type="source"
				/>
			)}
		</div>
	);
}
