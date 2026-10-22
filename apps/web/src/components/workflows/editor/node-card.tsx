import type { WorkflowNode, WorkflowPort } from "@tripwire/contracts";
import {
	acceptedPortKinds,
	outputPorts,
	WORKFLOW_PORT_KIND_LABELS,
	WORKFLOW_PORT_LABELS,
	WORKFLOW_PORT_TONE,
} from "@tripwire/contracts";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Button } from "#/components/glaze/ui/button";
import { StatusMark } from "#/components/glaze/ui/status";
import {
	handleReason,
	inputLook,
	type NodeVerdict,
	outputLook,
	portHandleId,
} from "#/components/workflows/editor/connection-plan";
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
import {
	useDragPlan,
	useNodeVerdict,
} from "#/components/workflows/editor/typed-connections";
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

type DropState = "open" | "closed" | undefined;

function OutputPort({
	port,
	corner,
	drop,
}: {
	port: WorkflowPort;
	corner: boolean;
	drop: DropState;
}) {
	const look = outputLook(port);
	return (
		<Handle
			data-drop={drop}
			data-port-io="out"
			data-port-shape={look.shape}
			data-port-slot={corner ? "corner" : "top"}
			data-port-tone={look.tone}
			id={portHandleId(port) ?? undefined}
			position={Position.Right}
			title={WORKFLOW_PORT_LABELS[port]}
			type="source"
		/>
	);
}

function PortCaption({ port }: { port: WorkflowPort }) {
	const tone = WORKFLOW_PORT_TONE[port];
	return (
		<span
			className={cn(
				"shrink-0 type-caption",
				tone === "ok" && "text-ok-text",
				tone === "fail" && "text-fail-text",
				tone === "neutral" && "text-text-3",
			)}
		>
			{WORKFLOW_PORT_LABELS[port]}
		</span>
	);
}

function dropState(
	verdict: NodeVerdict | null,
	handleId: string | null,
	io: "in" | "out",
	direction: "in" | "out" | undefined,
): DropState {
	if (!verdict || verdict.origin || direction === undefined) {
		return undefined;
	}
	if ((direction === "out") !== (io === "in")) {
		return undefined;
	}
	return handleReason(verdict, handleId) === null ? "open" : "closed";
}

export function TripwireNode({ data, selected }: NodeProps<TripwireFlowNode>) {
	const { node } = data;
	const issues = useNodeIssues(node.id);
	const editField = useEditField();
	const customName = useCustomRuleName(node.type === "rule" ? node.ref : "");
	const detail = nodeDetail(node);
	const fields = nodeFieldValues(node);
	const [topPort, cornerPort] = outputPorts(node);
	const input = inputLook(node.type);
	const verdict = useNodeVerdict(node.id);
	const direction = useDragPlan()?.direction;
	const nodeDrop = verdict
		? verdict.origin
			? "origin"
			: verdict.reason
				? "closed"
				: "open"
		: undefined;
	return (
		<div
			data-drop-node={nodeDrop}
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
			{input ? (
				<Handle
					data-drop={dropState(verdict, null, "in", direction)}
					data-port-io="in"
					data-port-shape={input.shape}
					data-port-slot="top"
					data-port-tone={input.tone}
					isConnectableStart={false}
					position={Position.Left}
					title={acceptedPortKinds(node.type)
						.map((kind) => WORKFLOW_PORT_KIND_LABELS[kind])
						.join(", ")}
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
					<span className="ms-auto flex">
						<PortCaption port={topPort} />
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
				<div className="mt-1 flex justify-end">
					<PortCaption port={cornerPort} />
				</div>
			) : null}
			{topPort ? (
				<OutputPort
					corner={false}
					drop={dropState(verdict, portHandleId(topPort), "out", direction)}
					port={topPort}
				/>
			) : null}
			{cornerPort ? (
				<OutputPort
					corner
					drop={dropState(verdict, portHandleId(cornerPort), "out", direction)}
					port={cornerPort}
				/>
			) : null}
		</div>
	);
}
