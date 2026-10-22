import type { WorkflowNode, WorkflowPort } from "@tripwire/contracts";
import {
	outputPorts,
	WORKFLOW_INPUT_LABELS,
	WORKFLOW_PORT_LABELS,
} from "@tripwire/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Button } from "#/components/glaze/ui/button";
import { StatusMark } from "#/components/glaze/ui/status";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import {
	useCustomRuleName,
	useEditField,
	useNodeIssues,
} from "#/components/workflows/editor/node-issues";
import { stepName } from "#/components/workflows/editor/step-meta";
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
 * node-fields.ts; a row click opens the panel on that field). Selected = strong
 * line; invalid = fail mark with the issue list as its title. Handle ids are LOAD-BEARING:
 * `handleWhen` maps "fail" / "approve" / "deny" handle ids to edge `when`s —
 * the port blocks are appearance only, every id and type is unchanged.
 */

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

/**
 * Ports carry meaning by POSITION, COLOR and a short caption. Tabs that come
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

function portHandleId(port: WorkflowPort): string | undefined {
	return port === "event" || port === "pass" ? undefined : port;
}

function portTone(port: WorkflowPort): string | null {
	switch (port) {
		case "pass":
		case "approve":
			return PORT_POSITIVE;
		case "fail":
		case "deny":
			return PORT_NEGATIVE;
		default:
			return null;
	}
}

function OutputPort({ port, corner }: { port: WorkflowPort; corner: boolean }) {
	return (
		<Handle
			className={cn(PORT_CLASS, portTone(port), "!-right-2")}
			id={portHandleId(port)}
			position={Position.Right}
			style={corner ? PORT_CORNER : PORT_TOP}
			title={`Output: ${WORKFLOW_PORT_LABELS[port]}`}
			type="source"
		/>
	);
}

export function TripwireNode({ data, selected }: NodeProps<TripwireFlowNode>) {
	const { node } = data;
	const issues = useNodeIssues(node.id);
	const editField = useEditField();
	const customName = useCustomRuleName(node.type === "rule" ? node.ref : "");
	const detail = nodeDetail(node);
	const fields = nodeFieldValues(node);
	const [topPort, cornerPort] = outputPorts(node);
	const inputLabel = WORKFLOW_INPUT_LABELS[node.type];
	return (
		<div
			className={cn(
				"relative w-56 rounded-panel border border-line-faint bg-paper px-3 py-2 text-text-1 transition-colors duration-(--dur-state)",
				cornerPort && "min-h-16",
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
			{inputLabel ? (
				<Handle
					className={cn(PORT_CLASS, "!-left-2")}
					position={Position.Left}
					style={PORT_TOP}
					title={`Input: ${inputLabel}`}
					type="target"
				/>
			) : null}
			<div className="flex items-baseline gap-1">
				<span className="min-w-0 truncate type-label">
					{stepName(node, customName)}
				</span>
				{node.type === "gate" ? (
					<span className="shrink-0 type-caption text-text-2">Gate</span>
				) : null}
				{topPort ? (
					<span className="ms-auto shrink-0 type-caption text-text-3">
						{WORKFLOW_PORT_LABELS[topPort]}
					</span>
				) : null}
			</div>
			{detail ? (
				<div className="truncate type-code-xs text-text-3">{detail}</div>
			) : null}
			{fields.length > 0 ? (
				<div className="mt-2 flex flex-col border-line-faint border-t pt-1">
					{fields.map(({ field, value }) => (
						<div className="-mx-2.5" key={field.key}>
							<Button
								aria-label={`Edit ${field.label}`}
								className="w-full justify-between"
								onClick={() => editField(node.id, field.key)}
								size="sm"
								variant="ghost"
							>
								<span className="min-w-0 truncate text-text-2">
									{field.label}
								</span>
								<span className="max-w-1/2 shrink-0 truncate">
									{summarizeFieldValue(field, value)}
								</span>
							</Button>
						</div>
					))}
				</div>
			) : null}
			{cornerPort ? (
				<div className="mt-1 text-end type-caption text-text-3">
					{WORKFLOW_PORT_LABELS[cornerPort]}
				</div>
			) : null}
			{topPort ? <OutputPort corner={false} port={topPort} /> : null}
			{cornerPort ? <OutputPort corner port={cornerPort} /> : null}
		</div>
	);
}
